import { Vault } from '@/contracts/Vault';
import { Vault__factory } from '@/contracts/factories/Vault__factory';
import { balancerVault } from '@/lib/constants/config';
import { GraphQLArgs } from '@/lib/graphql';
import { Sor } from '@/modules/sor/sor.module';
import {
  BatchSwapBuilder,
  SingleSwapBuilder,
} from '@/modules/swaps/swap_builder';
import { BalancerSdkConfig } from '@/types';
import { SOR, SubgraphPoolBase, SwapInfo, SwapTypes } from '@balancer-labs/sor';
import { BigNumber } from '@ethersproject/bignumber';
import { AddressZero } from '@ethersproject/constants';
import {
  convertSimpleFlashSwapToBatchSwapParameters,
  querySimpleFlashSwap,
} from './flashSwap';
import { getLimitsForSlippage } from './helpers';
import { getSorSwapInfo, queryBatchSwap } from './queryBatchSwap';
import {
  BatchSwap,
  BuildTransactionParameters,
  FindRouteParameters,
  QuerySimpleFlashSwapParameters,
  QuerySimpleFlashSwapResponse,
  SimpleFlashSwapParameters,
  SwapAttributes,
  SwapInput,
  SwapType,
  SwapsOptions,
  TokenAmounts,
} from './types';

const buildRouteDefaultOptions = {
  maxPools: 4,
  gasPrice: '1',
  deadline: '999999999999999999',
  maxSlippage: 10, // in bspt, eg: 10 = 0.1%
};

export class Swaps {
  readonly sor: SOR;
  chainId: number;
  vaultContract: Vault;

  // TODO: sorOrConfig - let's make it more predictable and always pass configuration explicitly
  constructor(sorOrConfig: SOR | BalancerSdkConfig) {
    if (sorOrConfig instanceof SOR) {
      this.sor = sorOrConfig;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.chainId = (<any>this.sor.provider)['_network']['chainId'];
    } else {
      this.sor = new Sor(sorOrConfig);
      if (typeof sorOrConfig.network === 'number')
        this.chainId = sorOrConfig.network as number;
      else this.chainId = sorOrConfig.network.chainId;
    }

    this.vaultContract = Vault__factory.connect(
      balancerVault(this.chainId),
      this.sor.provider
    );
  }

  static getLimitsForSlippage(
    tokensIn: string[],
    tokensOut: string[],
    swapType: SwapType,
    deltas: string[],
    assets: string[],
    slippage: string
  ): string[] {
    // TO DO - Check best way to do this?
    const limits = getLimitsForSlippage(
      tokensIn,
      tokensOut,
      swapType,
      deltas,
      assets,
      slippage
    );

    return limits.map((l) => l.toString());
  }

  /**
   * Uses SOR to find optimal route for a trading pair and amount
   *
   * @param FindRouteParameters
   * @param FindRouteParameters.tokenIn Address
   * @param FindRouteParameters.tokenOut Address
   * @param FindRouteParameters.amount BigNumber with a trade amount
   * @param FindRouteParameters.gasPrice BigNumber current gas price
   * @param FindRouteParameters.maxPools number of pool included in path, default 4
   * @returns Best trade route information
   */
  async findRouteGivenIn({
    tokenIn,
    tokenOut,
    amount,
    gasPrice,
    maxPools = 4,
  }: FindRouteParameters): Promise<SwapInfo> {
    return this.sor.getSwaps(tokenIn, tokenOut, SwapTypes.SwapExactIn, amount, {
      gasPrice,
      maxPools,
    });
  }

  /**
   * Uses SOR to find optimal route for a trading pair and amount
   *
   * @param FindRouteParameters
   * @param FindRouteParameters.tokenIn Address
   * @param FindRouteParameters.tokenOut Address
   * @param FindRouteParameters.amount BigNumber with a trade amount
   * @param FindRouteParameters.gasPrice BigNumber current gas price
   * @param FindRouteParameters.maxPools number of pool included in path, default 4
   * @returns Best trade route information
   */
  async findRouteGivenOut({
    tokenIn,
    tokenOut,
    amount,
    gasPrice,
    maxPools = 4,
  }: FindRouteParameters): Promise<SwapInfo> {
    return this.sor.getSwaps(
      tokenIn,
      tokenOut,
      SwapTypes.SwapExactOut,
      amount,
      {
        gasPrice,
        maxPools,
      }
    );
  }

  /**
   * Uses SOR to find optimal route for a trading pair and amount
   *
   * @param BuildTransactionParameters
   * @param BuildTransactionParameters.userAddress Address
   * @param BuildTransactionParameters.swapInfo result of route finding
   * @param BuildTransactionParameters.kind 0 - givenIn, 1 - givenOut
   * @param BuildTransactionParameters.deadline block linux timestamp as string
   * @param BuildTransactionParameters.maxSlippage [bps], eg: 1 === 0.01%, 100 === 1%
   * @returns transaction request ready to send with signer.sendTransaction
   */
  buildSwap({
    userAddress,
    recipient,
    swapInfo,
    kind,
    deadline,
    maxSlippage,
  }: BuildTransactionParameters): SwapAttributes {
    if (!this.chainId) throw 'Missing network configuration';

    // one vs batch (gas cost optimisation when using single swap)
    const builder =
      swapInfo.swaps.length > 1
        ? new BatchSwapBuilder(swapInfo, kind, this.chainId)
        : new SingleSwapBuilder(swapInfo, kind, this.chainId);
    builder.setFunds(userAddress, recipient);
    builder.setDeadline(deadline);
    builder.setLimits(maxSlippage);

    const to = builder.to();
    const { functionName } = builder;
    const attributes = builder.attributes();
    const data = builder.data();
    const value = builder.value(maxSlippage);

    return { to, functionName, attributes, data, value };
  }

  /**
   * Uses SOR to find optimal route for a trading pair and amount
   * and builds a transaction request
   *
   * @param sender Sender of the swap
   * @param recipient Reciever of the swap
   * @param tokenIn Address of tokenIn
   * @param tokenOut Address of tokenOut
   * @param amount Amount of tokenIn to swap as a string with 18 decimals precision
   * @param options
   * @param options.maxPools number of pool included in path
   * @param options.gasPrice BigNumber current gas price
   * @param options.deadline BigNumber block timestamp
   * @param options.maxSlippage [bps], eg: 1 === 0.01%, 100 === 1%
   * @returns transaction request ready to send with signer.sendTransaction
   */
  async buildRouteExactIn(
    sender: string,
    recipient: string,
    tokenIn: string,
    tokenOut: string,
    amount: string,
    options: SwapsOptions = buildRouteDefaultOptions
  ): Promise<SwapAttributes> {
    const opts = {
      ...buildRouteDefaultOptions,
      ...options,
    };

    const swapInfo = await this.findRouteGivenIn({
      tokenIn,
      tokenOut,
      amount: BigNumber.from(amount),
      gasPrice: BigNumber.from(opts.gasPrice),
      maxPools: opts.maxPools,
    });

    const tx = this.buildSwap({
      userAddress: sender, // sender account
      recipient, // recipient account
      swapInfo, // result from the previous step
      kind: SwapType.SwapExactIn, // or SwapExactOut
      deadline: opts.deadline, // BigNumber block timestamp
      maxSlippage: opts.maxSlippage, // [bps], eg: 1 == 0.01%, 100 == 1%
    });

    // TODO: add query support
    // query will be a function that returns the deltas for the swap in { [address: string]: string } format
    // const query = this.queryBatchSwap(tx);

    return tx;
  }

  /**
   * Encode batchSwap in an ABI byte string
   *
   * [See method for a batchSwap](https://dev.balancer.fi/references/contracts/apis/the-vault#batch-swaps).
   *
   * _NB: This method doesn't execute a batchSwap -- it returns an [ABI byte string](https://docs.soliditylang.org/en/latest/abi-spec.html)
   * containing the data of the function call on a contract, which can then be sent to the network to be executed.
   * (ex. [sendTransaction](https://web3js.readthedocs.io/en/v1.2.11/web3-eth.html#sendtransaction)).
   *
   * @param {BatchSwap}           batchSwap - BatchSwap information used for query.
   * @param {SwapType}            batchSwap.kind - either exactIn or exactOut
   * @param {BatchSwapSteps[]}    batchSwap.swaps - sequence of swaps
   * @param {string[]}            batchSwap.assets - array contains the addresses of all assets involved in the swaps
   * @param {FundManagement}      batchSwap.funds - object containing information about where funds should be taken/sent
   * @param {number[]}            batchSwap.limits - limits for each token involved in the swap, where either the maximum number of tokens to send (by passing a positive value) or the minimum amount of tokens to receive (by passing a negative value) is specified
   * @param {string}              batchSwap.deadline -  time (in Unix timestamp) after which it will no longer attempt to make a trade
   * @returns {string}            encodedBatchSwapData - Returns an ABI byte string containing the data of the function call on a contract
   */
  static encodeBatchSwap(batchSwap: BatchSwap): string {
    const vaultInterface = Vault__factory.createInterface();

    return vaultInterface.encodeFunctionData('batchSwap', [
      batchSwap.kind,
      batchSwap.swaps,
      batchSwap.assets,
      batchSwap.funds,
      batchSwap.limits,
      batchSwap.deadline,
    ]);
  }

  /**
   * Encode simple flash swap into a ABI byte string
   *
   * A "simple" flash swap is an arbitrage executed with only two tokens and two pools,
   * swapping in the first pool and then back in the second pool for a profit. For more
   * complex flash swaps, you will have to use the batch swap method.
   *
   * Learn more: A [Flash Swap](https://dev.balancer.fi/resources/swaps/flash-swaps).
   *
   * @param {SimpleFlashSwapParameters}   params - BatchSwap information used for query.
   * @param {string}                      params.flashLoanAmount - initial input amount for the flash loan (first asset)
   * @param {string[]}                    params.poolIds - array of Balancer pool ids
   * @param {string[]}                    params.assets - array of token addresses
   * @param {string}                      params.walletAddress - array of token addresses
   * @returns {string}                    encodedBatchSwapData - Returns an ABI byte string containing the data of the function call on a contract
   */
  static encodeSimpleFlashSwap(params: SimpleFlashSwapParameters): string {
    return this.encodeBatchSwap(
      convertSimpleFlashSwapToBatchSwapParameters(params)
    );
  }

  /**
   * fetchPools saves updated pools data to SOR internal onChainBalanceCache.
   *
   * @returns Boolean indicating whether pools data was fetched correctly (true) or not (false).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async fetchPools(queryArgs?: GraphQLArgs): Promise<boolean> {
    return this.sor.fetchPools(queryArgs);
  }

  public getPools(): SubgraphPoolBase[] {
    return this.sor.getPools();
  }

  /**
   * queryBatchSwap simulates a call to `batchSwap`, returning an array of Vault asset deltas.
   * @param batchSwap - BatchSwap information used for query.
   * @param {SwapType} batchSwap.kind - either exactIn or exactOut.
   * @param {BatchSwapStep[]} batchSwap.swaps - sequence of swaps.
   * @param {string[]} batchSwap.assets - array contains the addresses of all assets involved in the swaps.
   * @returns {Promise<string[]>} Returns an array with the net Vault asset balance deltas. Positive amounts represent tokens (or ETH) sent to the
   * Vault, and negative amounts represent tokens (or ETH) sent by the Vault. Each delta corresponds to the asset at
   * the same index in the `assets` array.
   */
  async queryBatchSwap(
    batchSwap: Pick<BatchSwap, 'kind' | 'swaps' | 'assets'>
  ): Promise<string[]> {
    return await queryBatchSwap(
      this.vaultContract,
      batchSwap.kind,
      batchSwap.swaps,
      batchSwap.assets
    );
  }

  /**
   * Simple interface to test if a simple flash swap is valid and see potential profits.
   *
   * A "simple" flash swap is an arbitrage executed with only two tokens and two pools,
   * swapping in the first pool and then back in the second pool for a profit. For more
   * complex flash swaps, you will have to use the batch swap method.
   *
   * Learn more: A [Flash Swap](https://dev.balancer.fi/resources/swaps/flash-swaps).
   *
   * _NB: This method doesn't execute a flashSwap
   *
   * @param {SimpleFlashSwapParameters}   params - BatchSwap information used for query.
   * @param {string}                      params.flashLoanAmount - initial input amount for the flash loan (first asset)
   * @param {string[]}                    params.poolIds - array of Balancer pool ids
   * @param {string[]}                    params.assets - array of token addresses
   * @returns {Promise<{profits: Record<string, string>, isProfitable: boolean}>}       Returns an ethersjs transaction response
   */
  async querySimpleFlashSwap(
    params: Omit<QuerySimpleFlashSwapParameters, 'vaultContract'>
  ): Promise<QuerySimpleFlashSwapResponse> {
    return await querySimpleFlashSwap({
      ...params,
      vaultContract: this.vaultContract,
    });
  }

  /**
   * Use SOR to get swapInfo for tokenIn<>tokenOut.
   * @param {SwapInput} swapInput - Swap information used for querying using SOR.
   * @param {string} swapInput.tokenIn - Addresse of asset in.
   * @param {string} swapInput.tokenOut - Addresse of asset out.
   * @param {SwapType} swapInput.swapType - Type of Swap, ExactIn/Out.
   * @param {string} swapInput.amount - Amount used in swap.
   * @returns {Promise<SwapInfo>} SOR swap info.
   */
  async getSorSwap(swapInput: SwapInput): Promise<SwapInfo> {
    return await getSorSwapInfo(
      swapInput.tokenIn,
      swapInput.tokenOut,
      swapInput.swapType,
      swapInput.amount,
      this.sor
    );
  }

  async queryExactIn(swap: SwapInfo): Promise<TokenAmounts> {
    const deltas = await this.query(swap, SwapType.SwapExactIn);
    return this.assetDeltas(deltas.map(String), swap.tokenAddresses);
  }

  async queryExactOut(swap: SwapInfo): Promise<TokenAmounts> {
    const deltas = await this.query(swap, SwapType.SwapExactOut);
    return this.assetDeltas(deltas.map(String), swap.tokenAddresses);
  }

  private query(swap: SwapInfo, kind: SwapType): Promise<BigNumber[]> {
    const { swaps, tokenAddresses: assets } = swap;

    const funds = {
      sender: AddressZero,
      recipient: AddressZero,
      fromInternalBalance: false,
      toInternalBalance: false,
    };

    return this.vaultContract.callStatic.queryBatchSwap(
      kind,
      swaps,
      assets,
      funds
    );
  }

  private assetDeltas(deltas: string[], assets: string[]): TokenAmounts {
    return Object.fromEntries(deltas.map((delta, idx) => [assets[idx], delta]));
  }
}
