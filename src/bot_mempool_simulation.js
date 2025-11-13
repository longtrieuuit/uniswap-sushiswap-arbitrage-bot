/**
 * BOT MEMPOOL VỚI SIMULATION
 * Giám sát pending transactions và simulate để detect arbitrage
 *
 * KHÔNG dựa vào filter address đơn giản
 * MÀ simulate transaction để tính price impact thực tế
 */

require('dotenv').config()
require('colors')
const Web3 = require('web3')

// ABIs
const IFactory = require('@uniswap/v2-core/build/IUniswapV2Factory.json')
const IPair = require('@uniswap/v2-core/build/IUniswapV2Pair.json')
const IRouter = require('@uniswap/v2-periphery/build/IUniswapV2Router02.json')

// Cấu hình
const UNISWAP_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'
const SUSHISWAP_FACTORY = '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac'
const MIN_PROFIT_ETH = 0.01 // Minimum 0.01 ETH profit

// Setup Web3
const web3 = new Web3('wss://mainnet.infura.io/ws/v3/YOUR_PROJECT_ID')

// Contract instances
const uFactory = new web3.eth.Contract(IFactory.abi, UNISWAP_FACTORY)
const sFactory = new web3.eth.Contract(IFactory.abi, SUSHISWAP_FACTORY)

// Tracked pools
const trackedPools = new Map()

/**
 * BƯỚC 1: Khởi tạo tracked pools
 */
async function initializeTrackedPools() {
    // Ví dụ: Track WETH/USDC pool
    const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
    const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

    const uPair = await uFactory.methods.getPair(WETH, USDC).call()
    const sPair = await sFactory.methods.getPair(WETH, USDC).call()

    trackedPools.set(uPair.toLowerCase(), {
        dex: 'uniswap',
        token0: WETH,
        token1: USDC,
        contract: new web3.eth.Contract(IPair.abi, uPair)
    })

    trackedPools.set(sPair.toLowerCase(), {
        dex: 'sushiswap',
        token0: WETH,
        token1: USDC,
        contract: new web3.eth.Contract(IPair.abi, sPair)
    })

    console.log(`📊 Tracking ${trackedPools.size} pools`.green)
}

/**
 * BƯỚC 2: Decode swap call từ Uniswap V2 Pair
 */
function decodeSwapCall(data) {
    // Swap function signature: swap(uint amount0Out, uint amount1Out, address to, bytes data)
    // Function selector: 0x022c0d9f

    if (data.slice(0, 10) !== '0x022c0d9f') {
        return null
    }

    try {
        const decoded = web3.eth.abi.decodeParameters(
            ['uint256', 'uint256', 'address', 'bytes'],
            '0x' + data.slice(10)
        )

        return {
            amount0Out: decoded[0],
            amount1Out: decoded[1],
            to: decoded[2],
            callbackData: decoded[3]
        }
    } catch (error) {
        return null
    }
}

/**
 * BƯỚC 3: Trace transaction để tìm internal calls
 * LƯU Ý: Cần Geth với debug API enabled
 */
async function traceTransaction(tx) {
    try {
        // Dùng debug_traceCall để simulate và trace
        const trace = await web3.currentProvider.send({
            jsonrpc: '2.0',
            method: 'debug_traceCall',
            params: [
                {
                    from: tx.from,
                    to: tx.to,
                    data: tx.input,
                    gas: tx.gas,
                    gasPrice: tx.gasPrice,
                    value: tx.value || '0x0'
                },
                'latest',
                {
                    tracer: 'callTracer',
                    timeout: '5s'
                }
            ],
            id: Date.now()
        })

        if (trace.error) {
            return null
        }

        return trace.result
    } catch (error) {
        // Nếu node không support debug_traceCall, fallback
        console.log(`⚠️  Cannot trace: ${error.message}`.yellow)
        return null
    }
}

/**
 * BƯỚC 4: Extract affected pools từ trace
 */
function extractAffectedPools(trace) {
    const affected = []

    function traverse(call) {
        const address = call.to ? call.to.toLowerCase() : null

        // Kiểm tra nếu call này đến một tracked pool
        if (address && trackedPools.has(address)) {
            // Decode swap call
            const swapData = decodeSwapCall(call.input)
            if (swapData) {
                affected.push({
                    pool: address,
                    poolInfo: trackedPools.get(address),
                    ...swapData
                })
            }
        }

        // Traverse internal calls
        if (call.calls && call.calls.length > 0) {
            call.calls.forEach(traverse)
        }
    }

    traverse(trace)
    return affected
}

/**
 * BƯỚC 5: Tính reserves sau transaction
 */
function calculateNewReserves(reserves, amount0Out, amount1Out) {
    return {
        reserve0: BigInt(reserves.reserve0) - BigInt(amount0Out),
        reserve1: BigInt(reserves.reserve1) - BigInt(amount1Out)
    }
}

/**
 * BƯỚC 6: Tính price impact
 */
function calculatePriceImpact(oldReserves, newReserves) {
    const oldPrice = Number(oldReserves.reserve1) / Number(oldReserves.reserve0)
    const newPrice = Number(newReserves.reserve1) / Number(newReserves.reserve0)

    const impact = ((newPrice - oldPrice) / oldPrice) * 100
    return impact
}

/**
 * BƯỚC 7: Kiểm tra arbitrage opportunity
 */
async function checkArbitrage(affectedSwaps) {
    for (const swap of affectedSwaps) {
        const poolInfo = swap.poolInfo

        // Lấy current reserves
        const reserves = await poolInfo.contract.methods.getReserves().call()

        // Tính reserves sau swap
        const newReserves = calculateNewReserves(
            reserves,
            swap.amount0Out,
            swap.amount1Out
        )

        const impact = calculatePriceImpact(reserves, newReserves)

        console.log(
            `📈 ${poolInfo.dex} pool: `.cyan +
            `${impact > 0 ? '+' : ''}${impact.toFixed(2)}% price impact`.yellow
        )

        // TODO: So sánh với pool khác để tìm arbitrage
        // Đây là phần phức tạp, cần:
        // 1. Lấy reserves của pool tương ứng trên DEX khác
        // 2. Tính toán arbitrage amount
        // 3. Tính profit sau fees và gas

        if (Math.abs(impact) > 1) { // Impact > 1%
            console.log(`🎯 Large impact detected! Potential arbitrage`.green)
            // TODO: Calculate and execute arbitrage
        }
    }
}

/**
 * MAIN: Monitor mempool
 */
async function monitorMempool() {
    console.log('🚀 Starting mempool monitor with simulation...\n'.green)

    await initializeTrackedPools()

    // Subscribe pending transactions
    const subscription = web3.eth.subscribe('pendingTransactions')

    let processedCount = 0
    let skippedCount = 0

    subscription.on('data', async (txHash) => {
        try {
            // Lấy transaction details
            const tx = await web3.eth.getTransaction(txHash)

            if (!tx || !tx.to) {
                skippedCount++
                return
            }

            // ===== FILTER CƠ BẢN (Để giảm load) =====
            // Skip transactions với gas price quá thấp
            const gasPrice = parseInt(tx.gasPrice)
            if (gasPrice < web3.utils.toWei('50', 'gwei')) {
                skippedCount++
                return
            }

            // Skip transactions quá nhỏ
            if (tx.gas < 100000) {
                skippedCount++
                return
            }

            processedCount++

            // ===== SIMULATION & TRACING =====
            console.log(`\n🔍 Processing tx ${processedCount}: ${txHash.slice(0, 10)}...`.cyan)

            // Trace transaction
            const trace = await traceTransaction(tx)

            if (!trace) {
                // Fallback: Kiểm tra trực tiếp nếu tx.to là tracked pool
                const toAddress = tx.to.toLowerCase()
                if (trackedPools.has(toAddress)) {
                    console.log(`📍 Direct call to tracked pool: ${toAddress}`.yellow)
                    const swapData = decodeSwapCall(tx.input)
                    if (swapData) {
                        await checkArbitrage([{
                            pool: toAddress,
                            poolInfo: trackedPools.get(toAddress),
                            ...swapData
                        }])
                    }
                }
                return
            }

            // Extract affected pools
            const affectedPools = extractAffectedPools(trace)

            if (affectedPools.length > 0) {
                console.log(`✅ Found ${affectedPools.length} pool interactions`.green)
                await checkArbitrage(affectedPools)
            } else {
                console.log(`➖ No tracked pools affected`.gray)
            }

        } catch (error) {
            console.log(`❌ Error: ${error.message}`.red)
        }
    })

    subscription.on('error', (error) => {
        console.log(`❌ Subscription error: ${error.message}`.red)
    })

    // Stats every 30 seconds
    setInterval(() => {
        console.log(
            `\n📊 Stats: `.cyan +
            `Processed: ${processedCount}, `.green +
            `Skipped: ${skippedCount}`.gray
        )
    }, 30000)
}

// Start bot
monitorMempool().catch(console.error)

/**
 * NOTES:
 *
 * 1. CODE NÀY CẦN GETH NODE VỚI DEBUG API:
 *    - Infura/Alchemy KHÔNG hỗ trợ debug_traceCall
 *    - Cần run Geth node riêng với --http.api debug
 *    - Hoặc dùng Erigon node
 *
 * 2. TRÁNH PROXY/AGGREGATOR:
 *    - 1inch Router: 0x1111111254fb6c44bAC0beD2854e76F90643097d
 *    - Paraswap: 0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57
 *    - Matcha: 0xDef1C0ded9bec7F1a1670819833240f027b25EfF
 *    - → Trace sẽ tự detect internal calls đến pools
 *
 * 3. SMART CONTRACT WALLETS:
 *    - Gnosis Safe: 0x...
 *    - Argent: 0x...
 *    - → Trace cũng detect được
 *
 * 4. FLASH LOAN ARBITRAGE:
 *    - Aave flashloan → swap → swap → repay
 *    - → Trace thấy tất cả
 *
 * 5. PERFORMANCE:
 *    - Mempool có ~100-200 tx/giây
 *    - Trace mỗi tx mất ~100-500ms
 *    - → Cần filter thông minh để không bị overwhelm
 *
 * 6. ALTERNATIVE APPROACH:
 *    - Thay vì trace MỖI tx, có thể:
 *    - Subscribe pool.Sync events
 *    - Khi có Sync → biết reserves thay đổi
 *    - → Nhẹ hơn nhưng chậm hơn (sau khi mine)
 */
