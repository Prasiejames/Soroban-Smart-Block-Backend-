import { Router } from 'express';
import { prismaRead as prisma } from '../db';
import { getWasmVersionLineage } from './wasm-upgrade-collector';
import { getShieldedTransferHistory } from './shielded-transfer-handler';
import { getZkpVerificationHistory } from './zkp-verifier';

const router = Router();

/**
 * GET /api/v1/contracts/:address/wasm-history
 * Retrieve WASM bytecode upgrade history for a contract.
 */
router.get('/contracts/:address/wasm-history', async (req, res) => {
  try {
    const { address } = req.params;

    const contract = await prisma.contract.findUnique({
      where: { address },
      select: { id: true, name: true },
    });

    if (!contract) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    const lineage = await getWasmVersionLineage(address);

    res.json({
      contractAddress: address,
      contractName: contract.name,
      upgrades: lineage,
      totalVersions: lineage.length,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * GET /api/v1/contracts/:address/shielded-transfers
 * Retrieve shielded transfer history for privacy pool contracts.
 */
router.get('/contracts/:address/shielded-transfers', async (req, res) => {
  try {
    const { address } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);

    const contract = await prisma.contract.findUnique({
      where: { address },
      select: { id: true, name: true },
    });

    if (!contract) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    const transfers = await getShieldedTransferHistory(address, limit);

    res.json({
      contractAddress: address,
      contractName: contract.name,
      transfers,
      count: transfers.length,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * GET /api/v1/contracts/:address/zkp-verifications
 * Retrieve ZKP verification event history for verifier contracts.
 */
router.get('/contracts/:address/zkp-verifications', async (req, res) => {
  try {
    const { address } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);

    const contract = await prisma.contract.findUnique({
      where: { address },
      select: { id: true, name: true },
    });

    if (!contract) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    const verifications = await getZkpVerificationHistory(address, limit);

    res.json({
      contractAddress: address,
      contractName: contract.name,
      verifications,
      count: verifications.length,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * GET /api/v1/transactions/:hash/advanced-events
 * Retrieve all advanced event tracking data for a transaction.
 */
router.get('/transactions/:hash/advanced-events', async (req, res) => {
  try {
    const { hash } = req.params;

    const tx = await prisma.transaction.findUnique({
      where: { hash },
      select: { contractAddress: true, ledgerSequence: true },
    });

    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const [shielded, zkp] = await Promise.all([
      prisma.shieldedTransfer.findMany({
        where: { transactionHash: hash },
        select: {
          id: true,
          fromAddress: true,
          toAddress: true,
          amount: true,
          isConfidential: true,
        },
      }),
      prisma.zkpVerificationEvent.findMany({
        where: { transactionHash: hash },
        select: {
          id: true,
          proofType: true,
          verificationResult: true,
          certaintyPercent: true,
        },
      }),
    ]);

    res.json({
      transactionHash: hash,
      shieldedTransfers: shielded,
      zkpVerifications: zkp,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
