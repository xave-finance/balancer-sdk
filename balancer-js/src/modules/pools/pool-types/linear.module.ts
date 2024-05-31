import { BalancerNetworkConfig } from '@/types';
import { LinearPoolExit } from './concerns/linear/exit.concern';
import { LinearPoolJoin } from './concerns/linear/join.concern';
import { LinearPoolLiquidity } from './concerns/linear/liquidity.concern';
import { LinearPriceImpact } from './concerns/linear/priceImpact.concern';
import { LinearPoolSpotPrice } from './concerns/linear/spotPrice.concern';
import {
  ExitConcern,
  JoinConcern,
  LiquidityConcern,
  PriceImpactConcern,
  SpotPriceConcern,
} from './concerns/types';
import { PoolType } from './pool-type.interface';

export class Linear implements PoolType {
  constructor(
    networkConfig: BalancerNetworkConfig,
    public exit: ExitConcern = new LinearPoolExit(networkConfig),
    public join: JoinConcern = new LinearPoolJoin(),
    public liquidity: LiquidityConcern = new LinearPoolLiquidity(),
    public spotPriceCalculator: SpotPriceConcern = new LinearPoolSpotPrice(),
    public priceImpactCalculator: PriceImpactConcern = new LinearPriceImpact()
  ) {}
}
