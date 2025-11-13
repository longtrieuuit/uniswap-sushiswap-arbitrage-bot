/**
 * BOT MEMPOOL VỚI CALLDATA FILTER
 * Lọc transactions bằng cách tìm target addresses trong calldata
 *
 * GIẢM 99% transactions cần trace!
 */

require('dotenv').config()
require('colors')
const Web3 = require('web3')

// ABIs
const IFactory = require('@uniswap/v2-core/build/IUniswapV2Factory.json')
const IPair = require('@uniswap/v2-core/build/IUniswapV2Pair.json')

// Setup Web3
const projectId = process.env.PROJECT_ID || 'YOUR_INFURA_PROJECT_ID'
const web3 = new Web3(`wss://mainnet.infura.io/ws/v3/${projectId}`)

// ========================================
// TARGET ADDRESSES (lowercase, no 0x)
// ========================================

// Top tokens by volume
const TARGET_TOKENS = [
    'c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
    'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
    'dac17f958d2ee523a2206206994597c13d831ec7', // USDT
    '6b175474e89094c44da98b954eedeac495271d0f', // DAI
    '2260fac5e5542a773aa44fbcfedf7c193bc2c599', // WBTC
    '514910771af9ca656af840dff83e8264ecf986ca', // LINK
    '1f9840a85d5af5bf1d1762f925bdaddc4201f984', // UNI
]

// High-volume pairs
const TARGET_PAIRS = [
    'b4e16d0168e52d35cacd2c6185b44281ec28c9dc', // WETH/USDC Uniswap
    '397ff1542f962076d0bfe58ea045ffa2d347aca0', // WETH/USDC Sushiswap
    '0d4a11d5eeaac28ec3f61d100daf4d40471f1852', // WETH/USDT Uniswap
    '06da0fd433c1a5d7a4faa01111c044910a184553', // WETH/USDT Sushiswap
    'a478c2975ab1ea89e8196811f51a7b7ade33eb11', // WETH/DAI Uniswap
    'c3d03e4f041fd4cd388c549ee2a29a9e5075882f', // WETH/DAI Sushiswap
]

// Routers and aggregators
const TARGET_ROUTERS = [
    '7a250d5630b4cf539739df2c5dacb4c659f2488d', // Uniswap V2 Router
    'd9e1ce17f2641f24ae83637ab66a2cca9c378b9f', // Sushiswap Router
    '1111111254fb6c44bac0bed2854e76f90643097d', // 1inch Router
    'def1c0ded9bec7f1a1670819833240f027b25eff', // Matcha (0x)
    'def171fe48cf0115b1d80b88dc8eab59176fee57', // Paraswap
]

// Create Set for O(1) lookup
const TARGET_SET = new Set([
    ...TARGET_TOKENS,
    ...TARGET_PAIRS,
    ...TARGET_ROUTERS
])

// Known aggregators for priority scoring
const AGGREGATORS = {
    '1111111254fb6c44bac0bed2854e76f90643097d': '1inch',
    'def1c0ded9bec7f1a1670819833240f027b25eff': 'Matcha',
    'def171fe48cf0115b1d80b88dc8eab59176fee57': 'Paraswap',
    '216b4b4ba9f3e719726886d34a177484278bfcae': 'TokenlonExchange',
}

// ========================================
// CALLDATA PARSING
// ========================================

/**
 * Extract tất cả addresses từ calldata
 * Addresses trong calldata thường có format: 000000000000000000000000[40-char-address]
 */
function extractAddressesFromCalldata(calldata) {
    const addresses = []
    const data = calldata.toLowerCase().replace('0x', '')

    // Pattern: 24 zeros + 40 hex chars (address)
    const pattern = /0{24}([a-f0-9]{40})/g
    let match

    while ((match = pattern.exec(data)) !== null) {
        addresses.push(match[1])
    }

    // Cũng tìm addresses không có padding (trong packed encoding)
    // Pattern: đứng độc lập, không phải là part của number lớn hơn
    const unpadded = /(?:^|[^a-f0-9])([a-f0-9]{40})(?:[^a-f0-9]|$)/g

    while ((match = unpadded.exec(data)) !== null) {
        const addr = match[1]
        // Check if starts with valid ethereum address prefix
        // (Most addresses start with specific patterns)
        if (!addresses.includes(addr)) {
            addresses.push(addr)
        }
    }

    return [...new Set(addresses)] // Remove duplicates
}

/**
 * Kiểm tra calldata có chứa target addresses không
 */
function containsTargetAddress(calldata) {
    const addresses = extractAddressesFromCalldata(calldata)

    const matches = []
    for (const addr of addresses) {
        if (TARGET_SET.has(addr)) {
            matches.push(addr)
        }
    }

    if (matches.length > 0) {
        return {
            match: true,
            targets: matches,
            allAddresses: addresses
        }
    }

    return {
        match: false,
        allAddresses: addresses
    }
}

/**
 * Phân loại transaction theo priority
 */
function classifyTransaction(tx) {
    // Check gas price
    const gasPrice = parseInt(tx.gasPrice)
    const minGasPrice = web3.utils.toWei('30', 'gwei')

    if (gasPrice < minGasPrice) {
        return { pass: false, reason: 'low_gas_price' }
    }

    // Check if contract call
    if (!tx.to) {
        return { pass: false, reason: 'contract_creation' }
    }

    if (!tx.input || tx.input === '0x') {
        return { pass: false, reason: 'simple_transfer' }
    }

    // Check calldata
    const calldataResult = containsTargetAddress(tx.input)

    if (!calldataResult.match) {
        return { pass: false, reason: 'no_target_address' }
    }

    // Check tx.to
    const to = tx.to.toLowerCase().replace('0x', '')

    // Priority HIGH: Direct call to target
    if (TARGET_SET.has(to)) {
        return {
            pass: true,
            priority: 'HIGH',
            method: 'direct_call',
            target: to,
            targets: calldataResult.targets,
            color: 'green'
        }
    }

    // Priority MEDIUM: Known aggregator
    if (AGGREGATORS[to]) {
        return {
            pass: true,
            priority: 'MEDIUM',
            method: 'aggregator',
            aggregator: AGGREGATORS[to],
            targets: calldataResult.targets,
            color: 'yellow'
        }
    }

    // Priority LOW: Unknown contract but contains target addresses
    return {
        pass: true,
        priority: 'LOW',
        method: 'unknown_contract',
        contractAddress: to,
        targets: calldataResult.targets,
        color: 'cyan'
    }
}

// ========================================
// STATISTICS
// ========================================

const stats = {
    total: 0,
    filtered: {
        low_gas_price: 0,
        contract_creation: 0,
        simple_transfer: 0,
        no_target_address: 0
    },
    passed: {
        HIGH: 0,
        MEDIUM: 0,
        LOW: 0
    },
    startTime: Date.now()
}

function printStats() {
    const elapsed = (Date.now() - stats.startTime) / 1000
    const txPerSec = (stats.total / elapsed).toFixed(2)

    const totalFiltered = Object.values(stats.filtered).reduce((a, b) => a + b, 0)
    const totalPassed = Object.values(stats.passed).reduce((a, b) => a + b, 0)
    const filterRate = ((totalFiltered / stats.total) * 100).toFixed(2)
    const passRate = ((totalPassed / stats.total) * 100).toFixed(2)

    console.log('\n' + '='.repeat(70))
    console.log('📊 STATISTICS'.cyan.bold)
    console.log('='.repeat(70))
    console.log(`⏱️  Runtime: ${elapsed.toFixed(0)}s | TX/s: ${txPerSec}`)
    console.log(`📥 Total transactions: ${stats.total}`)
    console.log('')
    console.log('🚫 FILTERED OUT:'.red + ` ${totalFiltered} (${filterRate}%)`)
    console.log(`   - Low gas price: ${stats.filtered.low_gas_price}`)
    console.log(`   - Contract creation: ${stats.filtered.contract_creation}`)
    console.log(`   - Simple transfer: ${stats.filtered.simple_transfer}`)
    console.log(`   - No target address: ${stats.filtered.no_target_address}`)
    console.log('')
    console.log('✅ PASSED:'.green + ` ${totalPassed} (${passRate}%)`)
    console.log(`   - HIGH priority: ${stats.passed.HIGH}`.green)
    console.log(`   - MEDIUM priority: ${stats.passed.MEDIUM}`.yellow)
    console.log(`   - LOW priority: ${stats.passed.LOW}`.cyan)
    console.log('='.repeat(70) + '\n')
}

// ========================================
// MAIN MONITOR
// ========================================

async function monitorMempool() {
    console.log('🚀 Starting Calldata Filter Bot...\n'.green.bold)
    console.log(`📍 Tracking ${TARGET_TOKENS.length} tokens`.cyan)
    console.log(`📍 Tracking ${TARGET_PAIRS.length} pairs`.cyan)
    console.log(`📍 Tracking ${TARGET_ROUTERS.length} routers/aggregators`.cyan)
    console.log('')

    const subscription = web3.eth.subscribe('pendingTransactions')

    subscription.on('data', async (txHash) => {
        try {
            stats.total++

            // Fetch transaction (cached by Infura)
            const tx = await web3.eth.getTransaction(txHash)

            if (!tx) return

            // Classify transaction
            const result = classifyTransaction(tx)

            // Update stats
            if (!result.pass) {
                stats.filtered[result.reason]++
                return
            }

            // PASS!
            stats.passed[result.priority]++

            // Log matched transaction
            const color = result.color
            const txShort = txHash.slice(0, 10)
            const targetShort = result.targets.map(t => t.slice(0, 8)).join(', ')

            console.log(
                `[${result.priority}]`[color].bold +
                ` ${txShort}... `.white +
                `| ${result.method} `.gray +
                `| Targets: ${targetShort}...`[color]
            )

            if (result.aggregator) {
                console.log(`   └─ Aggregator: ${result.aggregator}`.gray)
            }

            // ===== TODO: TRACE & ANALYZE =====
            // Ở đây bạn có thể:
            // 1. Trace transaction (nếu có Geth node)
            // 2. Simulate để tính price impact
            // 3. Check arbitrage opportunity
            // 4. Send bundle để frontrun

            // Example (requires Geth with debug API):
            // const trace = await traceTransaction(tx)
            // const affectedPools = extractAffectedPools(trace)
            // await checkArbitrage(affectedPools)

        } catch (error) {
            // Ignore errors (tx might be pending and not available yet)
            if (error.message.includes('not found')) {
                return
            }
            console.log(`❌ Error: ${error.message}`.red)
        }
    })

    subscription.on('error', (error) => {
        console.log(`❌ Subscription error: ${error.message}`.red)
    })

    subscription.on('connected', () => {
        console.log('✅ Connected to mempool!\n'.green)
    })

    // Print stats every 30 seconds
    setInterval(printStats, 30000)

    // Print initial stats after 10 seconds
    setTimeout(printStats, 10000)
}

// ========================================
// START
// ========================================

monitorMempool().catch(error => {
    console.log(`💥 Fatal error: ${error.message}`.red.bold)
    process.exit(1)
})

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down...'.yellow)
    printStats()
    process.exit(0)
})

// ========================================
// NOTES
// ========================================

/*

USAGE:
------
1. Cài dependencies:
   npm install web3 dotenv colors

2. Tạo file .env:
   PROJECT_ID=your_infura_project_id

3. Run:
   node src/bot_calldata_filter.js

4. Quan sát output:
   - Transactions được filter theo priority
   - Stats được print mỗi 30 giây
   - Ctrl+C để thoát và xem final stats


EXPECTED RESULTS:
-----------------
Với mainnet mempool (~200 tx/s):
- 70-80% filtered by gas price, simple transfers
- 15-20% filtered by no target address
- 1-5% PASSED và cần analyze

→ Chỉ cần trace ~2-10 tx/s thay vì 200 tx/s!


NEXT STEPS:
-----------
1. Implement tracing (cần Geth node):
   - debug_traceCall để trace internal calls
   - Extract affected pools
   - Calculate price impact

2. Implement arbitrage detection:
   - Compare prices across DEXs
   - Calculate optimal trade amount
   - Estimate profit after fees & gas

3. Implement execution:
   - Build bundle with flashbots
   - Sign and submit
   - Monitor for inclusion


LIMITATIONS:
------------
1. Miss computed addresses:
   address pair = factory.getPair(tokenA, tokenB)
   → Address không có trong calldata

2. Miss storage-loaded addresses:
   address pair = pairs[pairId]
   → Load từ storage, không thấy trong calldata

3. Miss delegatecall patterns:
   proxy.delegatecall(implementation)
   → Implementation address ẩn

→ Để catch 100%, dùng EVENT-BASED approach (Sync events)

*/
