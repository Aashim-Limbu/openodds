// Standalone-only config for the OpenOdds spike harness.
import path from 'node:path';
import { setNetworkId } from '@midnight-ntwrk/midnight-js/network-id';

export const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

export const contractConfig = {
  privateStateStoreName: 'openodds-private-state',
  zkConfigPath: path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'openodds'),
};

export interface Config {
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
}

export class StandaloneConfig implements Config {
  indexer = 'http://127.0.0.1:8088/api/v3/graphql';
  indexerWS = 'ws://127.0.0.1:8088/api/v3/graphql/ws';
  node = 'http://127.0.0.1:9944';
  proofServer = 'http://127.0.0.1:6300';
  constructor() {
    setNetworkId('undeployed');
  }
}

/**
 * Public preview testnet. Every endpoint here was probed live on 2026-08-15:
 * proof server v8.0.3, rpc healthy, indexer serving both v3 and v4.
 * Faucet: https://midnight-tmnight-preview.nethermind.dev/ — issues tNIGHT,
 * which must then be delegated to generate the tDUST that pays fees.
 */
export class PreviewConfig implements Config {
  indexer = 'https://indexer.preview.midnight.network/api/v3/graphql';
  indexerWS = 'wss://indexer.preview.midnight.network/api/v3/graphql/ws';
  node = 'https://rpc.preview.midnight.network';
  proofServer = 'https://proof-server.preview.midnight.network';
  constructor() {
    setNetworkId('preview');
  }
}

export const configFor = (net: string): Config =>
  net === 'preview' ? new PreviewConfig() : new StandaloneConfig();

// Pre-funded genesis wallet on the standalone dev node.
export const GENESIS_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
