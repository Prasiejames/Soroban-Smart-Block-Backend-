import { prismaWrite as prisma } from '../db';
import { fetchEvents, getTransaction } from './rpc';
import { decodeTransaction } from './decoder';
import { ingestEvents } from './eventIngestor';
import { enqueueFailure } from './errorQueue';
import { barrierUpsertLedger, barrierUpsertContract, barrierUpsertTransaction } from './writeBarrier';

/**
 * Fetch, decode, and persist all transactions and events for [start, end].
 * Safe to call concurrently for non-overlapping ranges — all DB writes use
 * upsert so duplicate execution is idempotent.
 */
export async function processLedgerRange(start: number, end: number): Promise<void> {
  console.log(`[worker] Indexing ledgers ${start} → ${end}`);
  const events = await fetchEvents(start, end);

  for (const event of events) {
    // Serialised upserts — prevents duplicate-key races from parallel workers
    await barrierUpsertLedger(event.ledgerSequence, event.ledgerCloseTime);
    await barrierUpsertContract(event.contractId);

    const existingTx = await prisma.transaction.findUnique({ where: { hash: event.transactionHash } });
    if (!existingTx) {
      const txResult = await getTransaction(event.transactionHash).catch(() => null);
      const rawXdr = (txResult as any)?.envelopeXdr?.toXDR('base64') ?? '';
      const decoded = rawXdr
        ? await decodeTransaction(rawXdr).catch(async (err) => {
            await enqueueFailure({
              itemType: 'transaction',
              itemId: event.transactionHash,
              ledger: event.ledgerSequence,
              rawXdr,
              error: err,
            });
            return { contractAddress: event.contractId, functionName: null, functionArgs: null, humanReadable: null };
          })
        : { contractAddress: event.contractId, functionName: null, functionArgs: null, humanReadable: null };

      await barrierUpsertTransaction(event.transactionHash, {
        hash: event.transactionHash,
        ledgerSequence: event.ledgerSequence,
        ledgerCloseTime: event.ledgerCloseTime,
        sourceAccount: (txResult as any)?.sourceAccount ?? 'unknown',
        contractAddress: decoded.contractAddress,
        functionName: decoded.functionName,
        functionArgs: decoded.functionArgs as object ?? undefined,
        rawXdr,
        status: (txResult as any)?.status === 'SUCCESS' ? 'success' : 'failed',
        humanReadable: decoded.humanReadable,
        feeCharged: String((txResult as any)?.feeCharged ?? ''),
      });
    }
  }

  const stored = await ingestEvents(start, end);
  console.log(`[worker] ledgers ${start}–${end}: ${events.length} txs, ${stored} events`);
}
