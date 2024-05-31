import { BalancerError, BalancerErrorCode } from '@/balancerErrors';
import { isLinearish } from '@/lib/utils';
import { FX } from '@/modules/pools/pool-types/fx.module';
import { Gyro } from '@/modules/pools/pool-types/gyro.module';
import { BalancerNetworkConfig, PoolType } from '@/types';
import { ComposableStable } from './pool-types/composableStable.module';
import { Linear } from './pool-types/linear.module';
import { MetaStable } from './pool-types/metaStable.module';
import { Stable } from './pool-types/stable.module';
import { StablePhantom } from './pool-types/stablePhantom.module';
import { Weighted } from './pool-types/weighted.module';

/**
 * Wrapper around pool type specific methods.
 *
 * Returns a class instance of a type specific method handlers.
 */
export class PoolTypeConcerns {
  // constructor(
  //   config: BalancerSdkConfig,
  //   public weighted = new Weighted(),
  //   public stable = new Stable(),
  //   public composableStable = new ComposableStable(),
  //   public metaStable = new MetaStable(),
  //   public stablePhantom = new StablePhantom(),
  //   public linear = new Linear()
  // ) {}

  static from(
    poolType: PoolType,
    networkConfig: BalancerNetworkConfig
  ):
    | Weighted
    | Stable
    | ComposableStable
    | MetaStable
    | StablePhantom
    | Linear {
    // Calculate spot price using pool type
    switch (poolType) {
      case 'ComposableStable': {
        return new ComposableStable(networkConfig);
      }
      case 'FX': {
        return new FX();
      }
      case 'GyroE':
      case 'Gyro2':
      case 'Gyro3': {
        return new Gyro();
      }
      case 'MetaStable': {
        return new MetaStable(networkConfig);
      }
      case 'Stable': {
        return new Stable(networkConfig);
      }
      case 'StablePhantom': {
        return new StablePhantom();
      }
      case 'Investment':
      case 'LiquidityBootstrapping':
      case 'Weighted': {
        return new Weighted(networkConfig);
      }
      default: {
        // Handles all Linear pool types
        if (isLinearish(poolType)) return new Linear(networkConfig);
        throw new BalancerError(BalancerErrorCode.UNSUPPORTED_POOL_TYPE);
      }
    }
  }
}
