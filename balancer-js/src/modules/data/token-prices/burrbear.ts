import { Findable, Network, Price, TokenPrices } from '@/types';
import axios from 'axios';
import { Debouncer, tokenAddressForPricing } from '@/lib/utils';
import { Logger } from '@/lib/utils/logger';

interface BurrbearPricesResponse {
  data: {
    prices: {
      address: string;
      latestUSDPrice: string;
    }[];
  };
}

/**
 * Burrbear API price source implementation.
 */
export class BurrbearPriceRepository implements Findable<Price> {
  prices: { [key: string]: Promise<Price> } = {};
  debouncer: Debouncer<TokenPrices, string>;

  constructor(private burrbearApiUrl: string, private chainId: Network = 1) {
    this.debouncer = new Debouncer<TokenPrices, string>(
      this.fetch.bind(this),
      200,
      10
    );
  }

  private async fetch(
    addresses: string[],
    { signal }: { signal?: AbortSignal } = {}
  ): Promise<TokenPrices> {
    console.time(`fetching Burrbear prices for ${addresses.length} tokens`);

    try {
      const { data } = await axios.post<BurrbearPricesResponse>(
        this.burrbearApiUrl,
        {
          query: `
            query GetCurrentTokenPrices($addresses: [String!]!) {
              prices: tokenPrices(addresses: $addresses) {
                address
                latestUSDPrice
              }
            }
          `,
          variables: {
            addresses: addresses.map((addr) => addr.toLowerCase()),
          },
        },
        { signal }
      );

      const tokenPrices = Object.fromEntries(
        data.data.prices.map((token) => [
          token.address.toLowerCase(),
          { usd: token.latestUSDPrice },
        ])
      );

      return tokenPrices;
    } catch (error) {
      const message = ['Error fetching token prices from Burrbear API'];
      if (axios.isAxiosError(error)) {
        if (error.response?.status !== undefined) {
          message.push(`with status ${error.response.status}`);
        }
      } else {
        message.push(String(error));
      }

      const logger = Logger.getInstance();
      logger.warn(message.join(' '));

      return Promise.reject(message.join(' '));
    } finally {
      console.timeEnd(
        `fetching Burrbear prices for ${addresses.length} tokens`
      );
    }
  }

  async find(inputAddress: string): Promise<Price | undefined> {
    const address = tokenAddressForPricing(inputAddress, this.chainId);

    if (!this.prices[address]) {
      this.prices[address] = this.debouncer
        .fetch(address)
        .then((prices) => prices[address]);
    }

    return this.prices[address];
  }

  async findBy(attribute: string, value: string): Promise<Price | undefined> {
    if (attribute !== 'address') {
      return undefined;
    }

    return this.find(value);
  }
}
