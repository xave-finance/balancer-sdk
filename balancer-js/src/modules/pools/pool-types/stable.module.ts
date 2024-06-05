import { BalancerNetworkConfig } from '@/types';
import { StablePoolExit } from './concerns/stable/exit.concern';
import { StablePoolJoin } from './concerns/stable/join.concern';
import { StablePoolLiquidity } from './concerns/stable/liquidity.concern';
import { StablePoolPriceImpact } from './concerns/stable/priceImpact.concern';
import { StablePoolSpotPrice } from './concerns/stable/spotPrice.concern';
import {
  ExitConcern,
  JoinConcern,
  LiquidityConcern,
  PriceImpactConcern,
  SpotPriceConcern,
} from './concerns/types';
import { PoolType } from './pool-type.interface';

export class Stable implements PoolType {
  constructor(
    networkConfig: BalancerNetworkConfig,
    public exit: ExitConcern = new StablePoolExit(networkConfig),
    public join: JoinConcern = new StablePoolJoin(networkConfig),
    public liquidity: LiquidityConcern = new StablePoolLiquidity(),
    public spotPriceCalculator: SpotPriceConcern = new StablePoolSpotPrice(),
    public priceImpactCalculator: PriceImpactConcern = new StablePoolPriceImpact()
  ) {}
}
