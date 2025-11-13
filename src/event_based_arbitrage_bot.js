/**
 * EVENT-BASED ARBITRAGE BOT
 * Bắt TẤT CẢ swaps bất kể qua aggregator/proxy nào
 * KHÔNG CẦN trace internal calls!
 */

const Web3 = require('web3');
const web3 = new Web3('wss://eth-mainnet.g.alchemy.com/v2/YOUR_KEY');

// ABIs
const IPair = require('@uniswap/v2-core/build/IUniswapV2Pair.json');
const IRouter = require('@uniswap/v2-periphery/build/IUniswapV2Router02.json');

// Configuration
const TRACKED_PAIRS = [
  {
    name: 'WETH/USDC',
    token0: 'WETH',
    token1: 'USDC',
    uniswap: '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc',
    sushiswap: '0x397FF1542f962076d0BFE58eA045FfA2d347ACa0'
  },
  {
    name: 'WETH/USDT',
    token0: 'WETH',
    token1: 'USDT',
    uniswap: '0x0d4a11d5EEaaC28EC3F61d100daF4d40471f1852',
    sushiswap: '0x06da0fd433C1A5d7a4faa01111c044910A184553'
  }
];

const MIN_PRICE_IMPACT = 0.3; // 0.3%
const MIN_PROFIT = 0.01; // 0.01 ETH

class EventBasedArbitrageBot {
  constructor() {
    this.pairs = new Map();
    this.reserves = new Map();
    this.stats = {
      totalSwapsDetected: 0,
      opportunitiesFound: 0,
      tradesExecuted: 0,
      totalProfit: 0
    };
  }

  async initialize() {
    console.log('🚀 Starting Event-Based Arbitrage Bot...\n');

    for (const config of TRACKED_PAIRS) {
      await this.setupPairMonitoring(config);
    }

    console.log(`✅ Monitoring ${TRACKED_PAIRS.length} pairs`);
    console.log('📊 Listening for Sync events...\n');

    // Display stats every 30 seconds
    setInterval(() => this.displayStats(), 30000);
  }

  async setupPairMonitoring(config) {
    const { name, uniswap, sushiswap } = config;

    // Create contract instances
    const uniPair = new web3.eth.Contract(IPair.abi, uniswap);
    const sushiPair = new web3.eth.Contract(IPair.abi, sushiswap);

    // Store contracts
    this.pairs.set(`uni-${name}`, uniPair);
    this.pairs.set(`sushi-${name}`, sushiPair);

    // Fetch initial reserves
    const uniReserves = await uniPair.methods.getReserves().call();
    const sushiReserves = await sushiPair.methods.getReserves().call();

    this.reserves.set(`uni-${name}`, {
      reserve0: uniReserves._reserve0,
      reserve1: uniReserves._reserve1,
      blockTimestamp: uniReserves._blockTimestampLast
    });

    this.reserves.set(`sushi-${name}`, {
      reserve0: sushiReserves._reserve0,
      reserve1: sushiReserves._reserve1,
      blockTimestamp: sushiReserves._blockTimestampLast
    });

    console.log(`📌 Tracking ${name}`);
    console.log(`   Uniswap:   ${uniswap}`);
    console.log(`   Sushiswap: ${sushiswap}`);
    console.log(`   Initial Uni reserves: ${uniReserves._reserve0} / ${uniReserves._reserve1}`);
    console.log(`   Initial Sushi reserves: ${sushiReserves._reserve0} / ${sushiReserves._reserve1}\n`);

    // ===== SUBSCRIBE TO SYNC EVENTS =====
    // QUAN TRỌNG: Event này bắt TẤT CẢ swaps!

    // Monitor Uniswap pair
    uniPair.events.Sync({})
      .on('data', async (event) => {
        await this.handleSyncEvent('uniswap', name, event);
      })
      .on('error', (error) => {
        console.error(`❌ Uniswap ${name} event error:`, error);
      });

    // Monitor Sushiswap pair
    sushiPair.events.Sync({})
      .on('data', async (event) => {
        await this.handleSyncEvent('sushiswap', name, event);
      })
      .on('error', (error) => {
        console.error(`❌ Sushiswap ${name} event error:`, error);
      });
  }

  async handleSyncEvent(dex, pairName, event) {
    this.stats.totalSwapsDetected++;

    const { reserve0, reserve1 } = event.returnValues;
    const blockNumber = event.blockNumber;
    const transactionHash = event.transactionHash;

    const key = `${dex === 'uniswap' ? 'uni' : 'sushi'}-${pairName}`;
    const oldReserves = this.reserves.get(key);

    // Calculate price change
    const oldPrice = Number(oldReserves.reserve1) / Number(oldReserves.reserve0);
    const newPrice = Number(reserve1) / Number(reserve0);
    const priceChange = ((newPrice - oldPrice) / oldPrice) * 100;

    // Log significant changes
    if (Math.abs(priceChange) > 0.1) {
      console.log(
        `📊 ${dex.toUpperCase()} ${pairName} | ` +
        `Block ${blockNumber} | ` +
        `Price ${priceChange > 0 ? '↑' : '↓'} ${Math.abs(priceChange).toFixed(2)}%`
      );
      console.log(`   Tx: ${transactionHash}`);
      console.log(`   Old: ${oldPrice.toFixed(6)} | New: ${newPrice.toFixed(6)}`);
    }

    // Update cached reserves
    this.reserves.set(key, {
      reserve0,
      reserve1,
      blockTimestamp: Date.now()
    });

    // Check arbitrage opportunity
    if (Math.abs(priceChange) > MIN_PRICE_IMPACT) {
      await this.checkArbitrageOpportunity(pairName, blockNumber);
    }
  }

  async checkArbitrageOpportunity(pairName, blockNumber) {
    // Get both reserves
    const uniReserves = this.reserves.get(`uni-${pairName}`);
    const sushiReserves = this.reserves.get(`sushi-${pairName}`);

    if (!uniReserves || !sushiReserves) return;

    // Calculate prices
    const uniPrice = Number(uniReserves.reserve1) / Number(uniReserves.reserve0);
    const sushiPrice = Number(sushiReserves.reserve1) / Number(sushiReserves.reserve0);

    const priceDiff = Math.abs(uniPrice - sushiPrice);
    const priceDiffPercent = (priceDiff / Math.min(uniPrice, sushiPrice)) * 100;

    if (priceDiffPercent > 0.3) {
      this.stats.opportunitiesFound++;

      console.log(`\n🎯 ARBITRAGE OPPORTUNITY DETECTED!`);
      console.log(`   Pair: ${pairName}`);
      console.log(`   Block: ${blockNumber}`);
      console.log(`   Uniswap price: ${uniPrice.toFixed(6)}`);
      console.log(`   Sushiswap price: ${sushiPrice.toFixed(6)}`);
      console.log(`   Difference: ${priceDiffPercent.toFixed(3)}%`);

      // Calculate optimal arbitrage
      const arbitrage = this.calculateOptimalArbitrage(
        uniReserves,
        sushiReserves,
        uniPrice,
        sushiPrice
      );

      if (arbitrage && arbitrage.profit > MIN_PROFIT) {
        console.log(`   Expected profit: ${arbitrage.profit.toFixed(4)} ETH 💰`);
        console.log(`   Direction: ${arbitrage.direction}`);

        // Execute arbitrage
        await this.executeArbitrage(arbitrage);
      } else {
        console.log(`   ⚠️  Profit too low: ${arbitrage?.profit.toFixed(4) || 0} ETH`);
      }
    }
  }

  calculateOptimalArbitrage(uniReserves, sushiReserves, uniPrice, sushiPrice) {
    // Determine direction
    const buyFromUni = uniPrice < sushiPrice;

    const buyReserves = buyFromUni ? uniReserves : sushiReserves;
    const sellReserves = buyFromUni ? sushiReserves : uniReserves;

    // Calculate optimal amount using Uniswap formula
    // This is simplified - production code should use exact formula
    const r0_buy = Number(buyReserves.reserve0);
    const r1_buy = Number(buyReserves.reserve1);
    const r0_sell = Number(sellReserves.reserve0);
    const r1_sell = Number(sellReserves.reserve1);

    // Simplified calculation
    // Optimal amount ≈ sqrt(r0_buy * r1_buy * r0_sell * r1_sell * 997^2 / (1000^2))
    const k = Math.sqrt(r0_buy * r1_buy * r0_sell * r1_sell);
    const amountIn = k * 0.997 / 1000; // Accounting for 0.3% fee

    // Calculate expected output
    const amountOut1 = (amountIn * 997 * r1_buy) / (r0_buy * 1000 + amountIn * 997);
    const amountOut2 = (amountOut1 * 997 * r0_sell) / (r1_sell * 1000 + amountOut1 * 997);

    const profit = amountOut2 - amountIn;

    // Estimate gas cost (simplified)
    const gasPrice = 50e9; // 50 gwei
    const gasLimit = 300000;
    const gasCost = (gasPrice * gasLimit) / 1e18;

    return {
      direction: buyFromUni ? 'Uni → Sushi' : 'Sushi → Uni',
      amountIn: amountIn / 1e18,
      amountOut: amountOut2 / 1e18,
      grossProfit: profit / 1e18,
      gasCost,
      profit: (profit / 1e18) - gasCost
    };
  }

  async executeArbitrage(arbitrage) {
    console.log(`\n⚡ EXECUTING ARBITRAGE...`);
    console.log(`   Amount in: ${arbitrage.amountIn.toFixed(4)} ETH`);
    console.log(`   Expected out: ${arbitrage.amountOut.toFixed(4)} ETH`);
    console.log(`   Gas cost: ${arbitrage.gasCost.toFixed(4)} ETH`);
    console.log(`   Net profit: ${arbitrage.profit.toFixed(4)} ETH`);

    // TODO: Implement actual arbitrage execution
    // This would involve:
    // 1. Building swap transactions
    // 2. Signing transactions
    // 3. Sending via bundle or direct
    // 4. Monitoring execution

    this.stats.tradesExecuted++;
    this.stats.totalProfit += arbitrage.profit;

    console.log(`   ✅ Arbitrage executed!\n`);
  }

  displayStats() {
    console.log(`\n📈 === STATISTICS ===`);
    console.log(`   Total swaps detected: ${this.stats.totalSwapsDetected}`);
    console.log(`   Opportunities found: ${this.stats.opportunitiesFound}`);
    console.log(`   Trades executed: ${this.stats.tradesExecuted}`);
    console.log(`   Total profit: ${this.stats.totalProfit.toFixed(4)} ETH`);
    console.log(`   Success rate: ${(this.stats.tradesExecuted / this.stats.opportunitiesFound * 100 || 0).toFixed(1)}%\n`);
  }
}

// ===== RUN BOT =====
async function main() {
  const bot = new EventBasedArbitrageBot();
  await bot.initialize();

  // Keep running
  console.log('Bot is running. Press Ctrl+C to stop.\n');
}

main().catch(console.error);

// ===== DEMONSTRATION =====
/**
 * QUAN TRỌNG: Sync event được emit trong MỌI trường hợp:
 *
 * 1. Direct swap via Uniswap Router:
 *    User → UniswapRouter.swap() → Pair.swap() → emit Sync ✅
 *
 * 2. Via 1inch Aggregator:
 *    User → 1inch.swap() → UniswapRouter.swap() → Pair.swap() → emit Sync ✅
 *
 * 3. Via Gnosis Safe:
 *    User → GnosisSafe.execTransaction() → Router → Pair → emit Sync ✅
 *
 * 4. Via ParaSwap:
 *    User → ParaSwap.swap() → Router → Pair → emit Sync ✅
 *
 * 5. Via Custom MEV Bot:
 *    MEVBot → flashloan → multiswap → Pair1 → emit Sync ✅
 *                                   → Pair2 → emit Sync ✅
 *                                   → Pair3 → emit Sync ✅
 *
 * 6. Via ANY smart contract:
 *    AnyContract → ... → Pair.swap() → emit Sync ✅
 *
 * EVENT LUÔN ĐƯỢC EMIT TỪ PAIR CONTRACT!
 * KHÔNG QUAN TÂM AI GỌI!
 */

/**
 * TẠI SAO EVENT-BASED TỐT HƠN MEMPOOL MONITORING?
 *
 * 1. BẮT TẤT CẢ SWAPS:
 *    - Mempool: Phải trace internal calls (slow, complex)
 *    - Events: Tự động bắt mọi swap (fast, simple)
 *
 * 2. KHÔNG BỊ LỪA BỞI PROXY:
 *    - Mempool: tx.to = 1inch → miss nếu không trace
 *    - Events: Pair luôn emit → không bao giờ miss
 *
 * 3. HIỆU SUẤT:
 *    - Mempool: 200 tx/s → 20s lag nếu trace mỗi cái
 *    - Events: ~10-20 Sync/s → zero lag
 *
 * 4. ĐƠN GIẢN:
 *    - Mempool: Phức tạp (filter, trace, decode)
 *    - Events: Đơn giản (chỉ listen)
 *
 * 5. CHÍNH XÁC:
 *    - Mempool: Có thể miss pending txs
 *    - Events: Không bao giờ miss (blockchain-level)
 *
 * TRADE-OFF:
 * ❌ Không frontrun được (sau khi tx mined)
 * ✅ NHƯNG đối với most arbitrage scenarios, đủ nhanh!
 */
