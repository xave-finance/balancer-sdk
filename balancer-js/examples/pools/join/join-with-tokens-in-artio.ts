/**
 * Example showing how to use Pools module to join pools.
 *
 * Run with:
 * yarn example ./examples/pools/join/join-with-tokens-in.ts
 */
import { BalancerSDK, Network } from '@balancer-labs/sdk';
import {
  approveToken,
  getTokenBalance,
  reset,
  setTokenBalance,
} from 'examples/helpers';

async function join() {
  const balancer = new BalancerSDK({
    network: Network.ARTIO,
    rpcUrl: 'http://127.0.0.1:8200', // Using local fork for simulation
  });

  const { provider } = balancer;
  const signer = provider.getSigner();
  const address = await signer.getAddress();
  console.log('signer address: ', address);

  // 50/50 EURS/USDC ComposableStablePool
  const pool = await balancer.pools.find(
    '0xf0b886478d6c0c579e53facbcc6e4abce96ae4b2000000000000000000000004'
  );
  if (!pool) throw Error('Pool not found');

  // Tokens that will be provided to pool by joiner
  const tokensIn = [
    '0x29388a985c5904bfa13524f8c3cb8bc10a02864c', // Mock EURS
    '0x94d81606dca42d3680c0dfc1d93eeaf6c2d55f2d', // Mock USDC
  ];

  // Slots used to set the account balance for each token through hardhat_setStorageAt
  // Info fetched using npm package slot20
  const slots = [0, 0];

  const amountsIn = ['10000000', '10000000'];

  // Prepare local fork for simulation
  await reset(provider, 1777155, 'https://artio.rpc.berachain.com');
  await setTokenBalance(provider, address, tokensIn[0], amountsIn[0], slots[0]);
  await setTokenBalance(provider, address, tokensIn[1], amountsIn[1], slots[1]);
  await approveToken(
    tokensIn[0],
    balancer.contracts.vault.address,
    amountsIn[0],
    signer
  );
  await approveToken(
    tokensIn[1],
    balancer.contracts.vault.address,
    amountsIn[1],
    signer
  );

  // Checking balances to confirm success
  const tokenBalancesBefore = (
    await Promise.all(
      tokensIn.map((token) => getTokenBalance(token, address, provider))
    )
  ).map(String);

  // Build join transaction
  const slippage = '100'; // 100 bps = 1%
  const { to, data, minBPTOut } = pool.buildJoin(
    address,
    tokensIn,
    amountsIn,
    slippage
  );

  // Calculate price impact
  const priceImpact = await pool.calcPriceImpact(amountsIn, minBPTOut, true);

  // Submit join tx
  const transactionResponse = await signer.sendTransaction({
    to,
    data,
  });

  await transactionResponse.wait();

  const tokenBalancesAfter = (
    await Promise.all(
      tokensIn.map((token) => getTokenBalance(token, address, provider))
    )
  ).map(String);

  console.log('Balances before join:        ', tokenBalancesBefore);
  console.log('Balances after join:         ', tokenBalancesAfter);
  console.log('Min BPT expected after join: ', [minBPTOut.toString()]);
  console.log('Price impact:                ', priceImpact.toString());
}

join();
