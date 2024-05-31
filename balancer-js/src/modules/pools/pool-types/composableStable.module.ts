import { BalancerNetworkConfig } from '@/types';
import { ComposableStablePoolExit } from './concerns/composableStable/exit.concern';
import { ComposableStablePoolJoin } from './concerns/composableStable/join.concern';
import { StablePoolLiquidity } from './concerns/stable/liquidity.concern';
import { StablePoolPriceImpact } from './concerns/stable/priceImpact.concern';
import { PhantomStablePoolSpotPrice } from './concerns/stablePhantom/spotPrice.concern';
import {
  ExitConcern,
  JoinConcern,
  LiquidityConcern,
  PriceImpactConcern,
  SpotPriceConcern,
} from './concerns/types';
import { PoolType } from './pool-type.interface';

export class ComposableStable implements PoolType {
  constructor(
    networkConfig: BalancerNetworkConfig,
    public exit: ExitConcern = new ComposableStablePoolExit(networkConfig),
    public liquidity: LiquidityConcern = new StablePoolLiquidity(),
    public spotPriceCalculator: SpotPriceConcern = new PhantomStablePoolSpotPrice(),
    public priceImpactCalculator: PriceImpactConcern = new StablePoolPriceImpact(),
    public join: JoinConcern = new ComposableStablePoolJoin(networkConfig)
  ) {}
}
