import { BalancerNetworkConfig } from '@/types';
import {
  ExitConcern,
  JoinConcern,
  LiquidityConcern,
  PriceImpactConcern,
  SpotPriceConcern,
} from './concerns/types';
import { WeightedPoolExit } from './concerns/weighted/exit.concern';
import { WeightedPoolJoin } from './concerns/weighted/join.concern';
import { WeightedPoolLiquidity } from './concerns/weighted/liquidity.concern';
import { WeightedPoolPriceImpact } from './concerns/weighted/priceImpact.concern';
import { WeightedPoolSpotPrice } from './concerns/weighted/spotPrice.concern';
import { PoolType } from './pool-type.interface';

export class Weighted implements PoolType {
  constructor(
    networkConfig: BalancerNetworkConfig,
    public exit: ExitConcern = new WeightedPoolExit(networkConfig),
    public join: JoinConcern = new WeightedPoolJoin(networkConfig),
    public liquidity: LiquidityConcern = new WeightedPoolLiquidity(),
    public spotPriceCalculator: SpotPriceConcern = new WeightedPoolSpotPrice(),
    public priceImpactCalculator: PriceImpactConcern = new WeightedPoolPriceImpact()
  ) {}
}
