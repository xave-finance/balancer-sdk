import { StablePoolExit } from '@/modules/pools/pool-types/concerns/stable/exit.concern';
import { StablePoolJoin } from '@/modules/pools/pool-types/concerns/stable/join.concern';
import { BalancerNetworkConfig } from '@/types';
import { MetaStablePoolLiquidity } from './concerns/metaStable/liquidity.concern';
import { MetaStablePoolSpotPrice } from './concerns/metaStable/spotPrice.concern';
import { StablePoolPriceImpact } from './concerns/stable/priceImpact.concern';
import {
  ExitConcern,
  JoinConcern,
  LiquidityConcern,
  PriceImpactConcern,
  SpotPriceConcern,
} from './concerns/types';
import { PoolType } from './pool-type.interface';

export class MetaStable implements PoolType {
  constructor(
    networkConfig: BalancerNetworkConfig,
    public exit: ExitConcern = new StablePoolExit(networkConfig),
    public join: JoinConcern = new StablePoolJoin(networkConfig),
    public liquidity: LiquidityConcern = new MetaStablePoolLiquidity(),
    public spotPriceCalculator: SpotPriceConcern = new MetaStablePoolSpotPrice(),
    public priceImpactCalculator: PriceImpactConcern = new StablePoolPriceImpact()
  ) {}
}
