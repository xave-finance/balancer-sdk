import dotenv from 'dotenv';

import { getOnChainBalances } from '@/modules/sor/pool-data/onChainData';
import { BigNumber, BigNumberish, formatFixed } from '@ethersproject/bignumber';
import { hexlify, zeroPad } from '@ethersproject/bytes';
import { AddressZero, MaxUint256, WeiPerEther } from '@ethersproject/constants';
import {
  JsonRpcProvider,
  JsonRpcSigner,
  TransactionReceipt,
} from '@ethersproject/providers';
import { keccak256 } from '@ethersproject/solidity';
import { formatBytes32String } from '@ethersproject/strings';

import {
  BALANCER_NETWORK_CONFIG,
  BalancerError,
  BalancerErrorCode,
  BalancerNetworkConfig,
  BalancerSDK,
  ERC20__factory,
  GraphQLArgs,
  GraphQLQuery,
  Network,
  Pool,
  Pools,
  PoolsSubgraphOnChainRepository,
  PoolsSubgraphRepository,
  PoolWithMethods,
} from '@/.';
import { balancerVault } from '@/lib/constants/config';
import { parseEther } from '@ethersproject/units';
import { setBalance } from '@nomicfoundation/hardhat-network-helpers';

import { Contracts } from '@/modules/contracts/contracts.module';
import { Pools as PoolsProvider } from '@/modules/pools';
import { SubgraphPool } from '@/modules/subgraph/subgraph';
import { defaultAbiCoder, Interface } from '@ethersproject/abi';
import mainnetPools from '../fixtures/pools-mainnet.json';
import polygonPools from '../fixtures/pools-polygon.json';
import { PoolsJsonRepository } from './pools-json-repository';

const liquidityGaugeAbi = ['function deposit(uint value) payable'];
const liquidityGauge = new Interface(liquidityGaugeAbi);

dotenv.config();

export interface TxResult {
  transactionReceipt: TransactionReceipt;
  balanceDeltas: BigNumber[];
  internalBalanceDeltas: BigNumber[];
  gasUsed: BigNumber;
}

type JsonPools = { [key: number]: { data: { pools: SubgraphPool[] } } };

const jsonPools: JsonPools = {
  [Network.MAINNET]: mainnetPools as { data: { pools: SubgraphPool[] } },
  [Network.POLYGON]: polygonPools as { data: { pools: SubgraphPool[] } },
};

export const RPC_URLS: Record<number, string> = {
  [Network.MAINNET]: `http://127.0.0.1:8545`,
  [Network.GOERLI]: `http://127.0.0.1:8000`,
  [Network.POLYGON]: `http://127.0.0.1:8137`,
  [Network.ARBITRUM]: `http://127.0.0.1:8161`,
  [Network.ZKEVM]: `http://127.0.0.1:8101`,
};

export const FORK_NODES: Record<number, string> = {
  [Network.MAINNET]: `${process.env.ALCHEMY_URL}`,
  [Network.GOERLI]: `${process.env.ALCHEMY_URL_GOERLI}`,
  [Network.POLYGON]: `${process.env.ALCHEMY_URL_POLYGON}`,
  [Network.ARBITRUM]: `${process.env.ALCHEMY_URL_ARBITRUM}`,
  [Network.ZKEVM]: `${process.env.ALCHEMY_URL_ZKEVM}`,
  [Network.GNOSIS]: `${process.env.RPC_URL_GNOSIS}`,
};

/**
 * Setup local fork with approved token balance for a given account
 *
 * @param signer Account that will have token balance set and approved
 * @param tokens Token addresses which balance will be set and approved
 * @param slots Slot that stores token balance in memory - use npm package `slot20` to identify which slot to provide
 * @param balances Balances in EVM amounts
 * @param jsonRpcUrl Url with remote node to be forked locally
 * @param blockNumber Number of the block that the fork will happen
 */
export const forkSetup = async (
  signer: JsonRpcSigner,
  tokens: string[],
  slots: number[] | undefined,
  balances: string[],
  jsonRpcUrl: string,
  blockNumber?: number,
  isVyperMapping: boolean[] = Array(tokens.length).fill(false)
): Promise<void> => {
  await signer.provider.send('hardhat_reset', [
    {
      forking: {
        jsonRpcUrl,
        blockNumber,
      },
    },
  ]);
  if (!slots) {
    slots = await Promise.all(
      tokens.map(async (token) => findTokenBalanceSlot(signer, token))
    );
    console.log('slots: ' + slots);
  }
  for (let i = 0; i < tokens.length; i++) {
    // Set initial account balance for each token that will be used to join pool
    await setTokenBalance(
      signer,
      tokens[i],
      slots[i],
      balances[i],
      isVyperMapping[i]
    );

    // Approve appropriate allowances so that vault contract can move tokens
    await approveToken(tokens[i], MaxUint256.toString(), signer);
  }
};

export const reset = async (
  jsonRpcUrl: string,
  provider: JsonRpcProvider,
  blockNumber?: number
): Promise<void> => {
  await provider.send('hardhat_reset', [
    {
      forking: {
        jsonRpcUrl,
        blockNumber,
      },
    },
  ]);
};

/**
 * Set token balance for a given account
 *
 * @param signer Account that will have token balance set
 * @param token Token address which balance will be set
 * @param slot Slot memory that stores balance - use npm package `slot20` to identify which slot to provide
 * @param balance Balance in EVM amount
 */
export const setTokenBalance = async (
  signer: JsonRpcSigner,
  token: string,
  slot: number,
  balance: string,
  isVyperMapping = false
): Promise<void> => {
  const toBytes32 = (bn: BigNumber) => {
    return hexlify(zeroPad(bn.toHexString(), 32));
  };

  const setStorageAt = async (token: string, index: string, value: string) => {
    await signer.provider.send('hardhat_setStorageAt', [token, index, value]);
  };

  const signerAddress = await signer.getAddress();

  // Get storage slot index
  let index;
  if (isVyperMapping) {
    index = keccak256(
      ['uint256', 'uint256'],
      [slot, signerAddress] // slot, key
    );
  } else {
    index = keccak256(
      ['uint256', 'uint256'],
      [signerAddress, slot] // key, slot
    );
  }

  // Manipulate local balance (needs to be bytes32 string)
  await setStorageAt(
    token,
    index,
    toBytes32(BigNumber.from(balance)).toString()
  );
};

/**
 * Approve token balance for vault contract
 *
 * @param token Token address to be approved
 * @param amount Amount to be approved
 * @param signer Account that will have tokens approved
 */
export const approveToken = async (
  token: string,
  amount: string,
  signer: JsonRpcSigner
): Promise<boolean> => {
  const tokenContract = ERC20__factory.connect(token, signer);
  const txReceipt = await (
    await tokenContract.approve(balancerVault(Network.MAINNET), amount)
  ).wait();
  return txReceipt.status === 1;
};

export const setupPool = async (
  provider: PoolsProvider,
  poolId: string
): Promise<PoolWithMethods> => {
  const pool = await provider.find(poolId);
  if (!pool) throw new BalancerError(BalancerErrorCode.POOL_DOESNT_EXIST);
  return pool;
};

export const getErc20Balance = (
  token: string,
  provider: JsonRpcProvider,
  holder: string
): Promise<BigNumber> =>
  ERC20__factory.connect(token, provider).balanceOf(holder);

export const getBalances = async (
  tokens: string[],
  signer: JsonRpcSigner,
  signerAddress: string
): Promise<Promise<BigNumber[]>> => {
  const balances: Promise<BigNumber>[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === AddressZero) {
      balances[i] = signer.getBalance();
    } else {
      balances[i] = getErc20Balance(tokens[i], signer.provider, signerAddress);
    }
  }
  return Promise.all(balances);
};

export const getBalancesInternal = async (
  tokens: string[],
  signer: JsonRpcSigner,
  signerAddress: string
): Promise<Promise<BigNumber[]>> => {
  const chainId = await signer.getChainId();
  const { vault } = new Contracts(chainId, signer.provider).contracts;
  return vault.getInternalBalance(signerAddress, tokens);
};

export const formatAddress = (text: string): string => {
  if (text.match(/^(0x)?[0-9a-fA-F]{40}$/)) return text; // Return text if it's already a valid address
  return formatBytes32String(text).slice(0, 42);
};

export const formatId = (text: string): string => {
  if (text.match(/^(0x)?[0-9a-fA-F]{64}$/)) return text; // Return text if it's already a valid id
  return formatBytes32String(text);
};

export const move = async (
  token: string,
  from: string,
  to: string,
  provider: JsonRpcProvider
): Promise<BigNumber> => {
  const holder = await impersonateAccount(from, provider);
  const balance = await getErc20Balance(token, provider, from);
  await ERC20__factory.connect(token, provider)
    .connect(holder)
    .transfer(to, balance);

  return balance;
};

// https://hardhat.org/hardhat-network/docs/guides/forking-other-networks#impersonating-accounts
// WARNING: don't use hardhat SignerWithAddress to sendTransactions!!
// It's not working and we didn't have time to figure out why.
// Use JsonRpcSigner instead
export const impersonateAccount = async (
  account: string,
  provider: JsonRpcProvider
): Promise<JsonRpcSigner> => {
  await provider.send('hardhat_impersonateAccount', [account]);
  await setBalance(account, parseEther('10000'));
  return provider.getSigner(account);
};

export const stake = async (
  signer: JsonRpcSigner,
  pool: string,
  gauge: string,
  balance: BigNumber
): Promise<void> => {
  await (
    await ERC20__factory.connect(pool, signer).approve(gauge, MaxUint256)
  ).wait();

  await (
    await signer.sendTransaction({
      to: gauge,
      data: liquidityGauge.encodeFunctionData('deposit', [balance]),
    })
  ).wait();
};

export const accuracy = (
  amount: BigNumber,
  expectedAmount: BigNumber
): number => {
  if (amount.eq(expectedAmount)) return 1;
  if (expectedAmount.eq(0))
    throw new Error("Can't check accuracy for expectedAmount 0");
  const accuracyEvm = amount.mul(WeiPerEther).div(expectedAmount);
  const accuracy = formatFixed(accuracyEvm, 18);
  return parseFloat(accuracy);
};

/**
 * Helper to efficiently retrieve pool state from Subgraph and onChain given a pool id.
 */
export class TestPoolHelper {
  pools: PoolsSubgraphRepository;
  poolsOnChain: PoolsSubgraphOnChainRepository;
  networkConfig: BalancerNetworkConfig;

  constructor(
    private poolId: string,
    network: Network,
    rpcUrl: string,
    blockNumber: number,
    private onChain = true
  ) {
    const subgraphArgs: GraphQLArgs = {
      where: {
        id: {
          eq: poolId,
        },
      },
      block: { number: blockNumber },
    };
    const subgraphQuery: GraphQLQuery = { args: subgraphArgs, attrs: {} };
    const { networkConfig, data } = new BalancerSDK({
      network,
      rpcUrl,
      subgraphQuery,
    });
    this.pools = data.pools;
    this.poolsOnChain = data.poolsOnChain;
    this.networkConfig = networkConfig;
  }

  /**
   * Will retrieve onchain state if onChain was true in constructor.
   * @returns
   */
  async getPool(): Promise<PoolWithMethods> {
    const pool = this.onChain
      ? await this.poolsOnChain.find(this.poolId, true)
      : await this.pools.find(this.poolId);
    if (pool === undefined) throw new Error('Pool Not Found');
    const wrappedPool = Pools.wrap(pool, this.networkConfig);
    return wrappedPool;
  }
}

/**
 * Returns a pool from the json file as a Pool type defined in SubgraphPoolRepository.
 *
 * @param id pool ID
 * @param network we only support 1 and 137
 * @returns Pool as from the SubgraphPoolRepository
 */
export const getPoolFromFile = async (
  id: string,
  network: Network
): Promise<Pool> => {
  if (jsonPools[network] === undefined)
    throw new Error('No Pools JSON file for this network');
  const pool = await new PoolsJsonRepository(jsonPools[network], network).find(
    id
  );
  if (pool === undefined) throw new Error('Pool Not Found');
  return pool;
};

/**
 * Updates pool balances with onchain state.
 *
 * @param pool pool from repository
 * @param network we only support 1, 137 and 42161
 * @returns Pool as from the SubgraphPoolRepository
 */
export const updateFromChain = async (
  pool: Pool,
  network: Network,
  provider: JsonRpcProvider
): Promise<Pool> => {
  const onChainPool = await getOnChainBalances(
    [pool],
    BALANCER_NETWORK_CONFIG[network].addresses.contracts.multicall,
    BALANCER_NETWORK_CONFIG[network].addresses.contracts.vault,
    provider
  );
  return onChainPool[0];
};

export async function sendTransactionGetBalances(
  tokensForBalanceCheck: string[],
  signer: JsonRpcSigner,
  signerAddress: string,
  to: string,
  data: string,
  value?: BigNumberish
): Promise<TxResult> {
  const balanceBefore = await getBalances(
    tokensForBalanceCheck,
    signer,
    signerAddress
  );
  const balancesBeforeInternal = await getBalancesInternal(
    tokensForBalanceCheck,
    signer,
    signerAddress
  );
  // Send transaction to local fork
  const transactionResponse = await signer.sendTransaction({
    to,
    data,
    value,
  });
  const transactionReceipt = await transactionResponse.wait();
  const { gasUsed, effectiveGasPrice } = transactionReceipt;
  const gasPrice = gasUsed.mul(effectiveGasPrice);

  const balancesAfter = await getBalances(
    tokensForBalanceCheck,
    signer,
    signerAddress
  );
  const balancesAfterInternal = await getBalancesInternal(
    tokensForBalanceCheck,
    signer,
    signerAddress
  );

  const balanceDeltas = balancesAfter.map((balanceAfter, i) => {
    // ignore ETH delta from gas cost
    if (tokensForBalanceCheck[i] === AddressZero) {
      balanceAfter = balanceAfter.add(gasPrice);
    }
    return balanceAfter.sub(balanceBefore[i]).abs();
  });

  const internalBalanceDeltas = balancesAfterInternal.map((b, i) => {
    return b.sub(balancesBeforeInternal[i]).abs();
  });

  return {
    transactionReceipt,
    balanceDeltas,
    internalBalanceDeltas,
    gasUsed,
  };
}

export async function findTokenBalanceSlot(
  signer: JsonRpcSigner,
  tokenAddress: string
): Promise<number> {
  const encode = (types: string[], values: unknown[]): string =>
    defaultAbiCoder.encode(types, values);
  const account = await signer.getAddress();
  const probeA = encode(['uint256'], [(Math.random() * 10000).toFixed()]);
  const probeB = encode(['uint256'], [(Math.random() * 10000).toFixed()]);
  for (let i = 0; i < 999; i++) {
    let probedSlot = keccak256(['uint256', 'uint256'], [account, i]);
    // remove padding for JSON RPC
    while (probedSlot.startsWith('0x0'))
      probedSlot = '0x' + probedSlot.slice(3);
    const prev = await signer.provider.send('eth_getStorageAt', [
      tokenAddress,
      probedSlot,
      'latest',
    ]);
    // make sure the probe will change the slot value
    const probe = prev === probeA ? probeB : probeA;

    await signer.provider.send('hardhat_setStorageAt', [
      tokenAddress,
      probedSlot,
      probe,
    ]);

    const balance = await getErc20Balance(
      tokenAddress,
      signer.provider,
      account
    );
    // reset to previous value
    await signer.provider.send('hardhat_setStorageAt', [
      tokenAddress,
      probedSlot,
      prev,
    ]);
    if (balance.eq(BigNumber.from(probe))) return i;
  }
  throw new Error('Balance slot not found!');
}

export function createSubgraphQuery(
  pools: string[],
  blockNo: number
): GraphQLQuery {
  const subgraphArgs: GraphQLArgs = {
    where: {
      swapEnabled: {
        eq: true,
      },
      totalShares: {
        gt: 0.000000000001,
      },
      address: {
        in: pools,
      },
    },
    orderBy: 'totalLiquidity',
    orderDirection: 'desc',
    block: { number: blockNo },
  };
  const subgraphQuery: GraphQLQuery = { args: subgraphArgs, attrs: {} };
  return subgraphQuery;
}
