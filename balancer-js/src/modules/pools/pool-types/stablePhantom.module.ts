import { StablePoolLiquidity } from './concerns/stable/liquidity.concern';
import { StablePoolPriceImpact } from './concerns/stable/priceImpact.concern';
import { StablePhantomPoolExit } from './concerns/stablePhantom/exit.concern';
import { StablePhantomPoolJoin } from './concerns/stablePhantom/join.concern';
import { PhantomStablePoolSpotPrice } from './concerns/stablePhantom/spotPrice.concern';
import {
  ExitConcern,
  JoinConcern,
  LiquidityConcern,
  PriceImpactConcern,
  SpotPriceConcern,
} from './concerns/types';
import { PoolType } from './pool-type.interface';

export class StablePhantom implements PoolType {
  constructor(
    public exit: ExitConcern = new StablePhantomPoolExit(),
    public join: JoinConcern = new StablePhantomPoolJoin(),
    public liquidity: LiquidityConcern = new StablePoolLiquidity(),
    public spotPriceCalculator: SpotPriceConcern = new PhantomStablePoolSpotPrice(),
    public priceImpactCalculator: PriceImpactConcern = new StablePoolPriceImpact()
  ) {}
}
