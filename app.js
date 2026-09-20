// --- State ---
let chart = null;
let candlestickSeries = null;
let currentData = [];
let detectedPatterns = [];

// --- DOM Elements ---
const symbolInput = document.getElementById('symbolInput');
const timeframeSelect = document.getElementById('timeframeSelect');
const fetchDataBtn = document.getElementById('fetchDataBtn');
const apiError = document.getElementById('apiError');

const csvFileInput = document.getElementById('csvFileInput');
const csvError = document.getElementById('csvError');

const resultsBody = document.getElementById('resultsBody');
const chartContainer = document.getElementById('tvchart');

// --- Initialization ---
function initChart() {
    // Destroy existing chart if it exists
    if (chart) {
        chart.remove();
        chartContainer.innerHTML = '';
    }

    const chartProperties = {
        width: chartContainer.clientWidth,
        height: chartContainer.clientHeight,
        layout: {
            background: { type: 'solid', color: '#1e222d' },
            textColor: '#d1d4dc',
        },
        grid: {
            vertLines: { color: '#2a2e39' },
            horzLines: { color: '#2a2e39' },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
        },
        rightPriceScale: {
            borderColor: '#2a2e39',
        },
        timeScale: {
            borderColor: '#2a2e39',
            timeVisible: true,
            secondsVisible: false,
        },
    };

    chart = LightweightCharts.createChart(chartContainer, chartProperties);
    candlestickSeries = chart.addCandlestickSeries({
        upColor: '#089981',
        downColor: '#f23645',
        borderDownColor: '#f23645',
        borderUpColor: '#089981',
        wickDownColor: '#f23645',
        wickUpColor: '#089981',
    });

    // Handle resize
    window.addEventListener('resize', () => {
        chart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
    });
}

// --- Online Data Fetching (Binance API) ---
async function fetchBinanceData() {
    const symbol = symbolInput.value.trim().toUpperCase();
    const interval = timeframeSelect.value;

    if (!symbol) {
        showApiError("Please enter a symbol.");
        return;
    }

    apiError.textContent = "Fetching data...";

    try {
        // Fetch last 500 candles
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=500`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // Map Binance response to Lightweight Charts format
        // Binance response: [Open time, Open, High, Low, Close, Volume, Close time, ...]
        currentData = data.map(d => ({
            time: d[0] / 1000, // Convert ms to s
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5])
        }));

        apiError.textContent = "";
        processAndRenderData();

    } catch (error) {
        showApiError(`Failed to fetch data: ${error.message}. Check symbol or network.`);
        console.error(error);
    }
}

function showApiError(msg) {
    apiError.textContent = msg;
    setTimeout(() => { apiError.textContent = ""; }, 5000);
}

// --- Offline Data Parsing (CSV) ---
function handleCsvUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    csvError.textContent = "Parsing CSV...";

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true, // Automatically converts numbers
        complete: function(results) {
            if (results.errors.length > 0) {
                showCsvError("Error parsing CSV. Please check console for details.");
                console.error("PapaParse Errors:", results.errors);
                return;
            }

            try {
                // Map generic headers to Lightweight Charts format
                // Expected headers: Date, Open, High, Low, Close, Volume
                currentData = results.data.map(row => {
                    // Try to parse date
                    let timestamp;
                    if (row.Date) {
                        const parsedDate = new Date(row.Date);
                        if (!isNaN(parsedDate.getTime())) {
                            timestamp = parsedDate.getTime() / 1000;
                        } else {
                            // Try parsing as unix timestamp directly
                            timestamp = parseFloat(row.Date);
                            // If it's in ms, convert to s. Heuristic: if it's > 2000-01-01 in seconds (946684800)
                            // and has 13 digits, it's likely ms.
                            if (timestamp > 946684800000) timestamp /= 1000;
                        }
                    }

                    if (!timestamp || isNaN(timestamp) || !row.Open || !row.High || !row.Low || !row.Close) {
                        throw new Error("Invalid row data found. Check columns (Date, Open, High, Low, Close).");
                    }

                    return {
                        time: timestamp,
                        open: parseFloat(row.Open),
                        high: parseFloat(row.High),
                        low: parseFloat(row.Low),
                        close: parseFloat(row.Close),
                        volume: row.Volume ? parseFloat(row.Volume) : 0
                    };
                });

                // Sort by time just in case
                currentData.sort((a, b) => a.time - b.time);

                csvError.textContent = "";
                processAndRenderData();

            } catch (err) {
                showCsvError(err.message);
                console.error(err);
            }
        }
    });
}

function showCsvError(msg) {
    csvError.textContent = msg;
    setTimeout(() => { csvError.textContent = ""; }, 5000);
}

// --- Main Processing Flow ---
function processAndRenderData() {
    if (currentData.length === 0) return;

    // 1. Initialize Chart & Set Data
    initChart();
    candlestickSeries.setData(currentData);
    chart.timeScale().fitContent();

    // 2. Run Pattern Recognition
    detectedPatterns = [];
    detectPatterns();

    // 3. Render Markers on Chart
    renderMarkers();

    // 4. Populate Results Table
    renderTable();
}

// --- Pattern Recognition Engine ---

function detectPatterns() {
    const data = currentData;
    const len = data.length;

    for (let i = 2; i < len; i++) {
        const curr = data[i];
        const prev = data[i - 1];
        const prev2 = data[i - 2];

        // --- Candlestick Patterns ---

        // 1. Bullish Engulfing
        // Prev is bearish, Curr is bullish, Curr body engulfs Prev body
        if (prev.close < prev.open && curr.close > curr.open) {
            if (curr.open <= prev.close && curr.close >= prev.open) {
                addPattern(curr, 'Bullish Engulfing', 'bullish', curr.close);
            }
        }

        // 2. Bearish Engulfing
        // Prev is bullish, Curr is bearish, Curr body engulfs Prev body
        if (prev.close > prev.open && curr.close < curr.open) {
            if (curr.open >= prev.close && curr.close <= prev.open) {
                addPattern(curr, 'Bearish Engulfing', 'bearish', curr.close);
            }
        }

        // Helper variables for single candle patterns
        const bodySize = Math.abs(curr.close - curr.open);
        const totalSize = curr.high - curr.low;
        const upperWick = curr.high - Math.max(curr.open, curr.close);
        const lowerWick = Math.min(curr.open, curr.close) - curr.low;
        const isBullish = curr.close > curr.open;
        const isBearish = curr.close < curr.open;

        // 3. Doji
        // Very small body compared to total size
        if (totalSize > 0 && bodySize / totalSize < 0.1) {
            addPattern(curr, 'Doji', 'neutral', curr.close);
        }

        // 4. Hammer
        // Small body in upper part, long lower wick (at least 2x body), little/no upper wick
        if (totalSize > 0 && lowerWick > bodySize * 2 && upperWick < bodySize * 0.5 && bodySize / totalSize < 0.4) {
             // Basic trend check: assume downtrend if curr price is lower than 5 candles ago
             if (i >= 5 && curr.close < data[i-5].close) {
                 addPattern(curr, 'Hammer', 'bullish', curr.low);
             }
        }

        // 5. Shooting Star
        // Small body in lower part, long upper wick (at least 2x body), little/no lower wick
        if (totalSize > 0 && upperWick > bodySize * 2 && lowerWick < bodySize * 0.5 && bodySize / totalSize < 0.4) {
             // Basic trend check: assume uptrend if curr price is higher than 5 candles ago
             if (i >= 5 && curr.close > data[i-5].close) {
                 addPattern(curr, 'Shooting Star', 'bearish', curr.high);
             }
        }

        // 6. Morning Star
        // Prev2: Bearish, Prev: Small body (star), Curr: Bullish closing well into Prev2 body
        if (prev2.close < prev2.open &&
            Math.abs(prev.close - prev.open) / (prev.high - prev.low || 1) < 0.3 &&
            prev.open < prev2.close &&
            curr.close > curr.open &&
            curr.close > prev2.close + (prev2.open - prev2.close) / 2) {
                addPattern(curr, 'Morning Star', 'bullish', curr.close);
        }

        // 7. Evening Star
        // Prev2: Bullish, Prev: Small body (star), Curr: Bearish closing well into Prev2 body
        if (prev2.close > prev2.open &&
            Math.abs(prev.close - prev.open) / (prev.high - prev.low || 1) < 0.3 &&
            prev.open > prev2.close &&
            curr.close < curr.open &&
            curr.close < prev2.open + (prev2.close - prev2.open) / 2) {
                addPattern(curr, 'Evening Star', 'bearish', curr.close);
        }
    }

    // --- Basic Technical Shapes (Double Top / Bottom) ---
    // Simplified logic: look for local extremes over a window
    detectDoubleTopsBottoms(data);
}

function detectDoubleTopsBottoms(data) {
    const window = 10; // Lookback window for local pivot
    const tolerance = 0.01; // 1% tolerance for price match

    // Find pivots
    let pivots = []; // {type: 'high'|'low', index: i, price: p}
    for (let i = window; i < data.length - window; i++) {
        let isHigh = true;
        let isLow = true;
        for (let j = i - window; j <= i + window; j++) {
            if (i !== j) {
                if (data[j].high >= data[i].high) isHigh = false;
                if (data[j].low <= data[i].low) isLow = false;
            }
        }
        if (isHigh) pivots.push({type: 'high', index: i, price: data[i].high});
        if (isLow) pivots.push({type: 'low', index: i, price: data[i].low});
    }

    // Compare pivots for Double Top/Bottom
    for (let i = 0; i < pivots.length; i++) {
        for (let j = i + 1; j < Math.min(i + 5, pivots.length); j++) { // Only look at next few pivots
            const p1 = pivots[i];
            const p2 = pivots[j];

            // Need some distance between tops/bottoms (e.g., at least 5 candles)
            if (p2.index - p1.index < 5) continue;

            if (p1.type === 'high' && p2.type === 'high') {
                const diff = Math.abs(p1.price - p2.price) / p1.price;
                if (diff <= tolerance) {
                    addPattern(data[p2.index], 'Double Top', 'bearish', p2.price);
                }
            } else if (p1.type === 'low' && p2.type === 'low') {
                const diff = Math.abs(p1.price - p2.price) / p1.price;
                if (diff <= tolerance) {
                    addPattern(data[p2.index], 'Double Bottom', 'bullish', p2.price);
                }
            }
        }
    }
}

function addPattern(candle, name, type, price) {
    // Avoid duplicate markers on the same candle if they are of the same type conceptually
    const exists = detectedPatterns.some(p => p.time === candle.time && p.name === name);
    if (!exists) {
        detectedPatterns.push({
            time: candle.time,
            name: name,
            type: type,
            price: price
        });
    }
}

// --- Rendering ---

function renderMarkers() {
    if (!candlestickSeries) return;

    // Map patterns to Lightweight Charts marker format
    const markers = detectedPatterns.map(pattern => {
        let position, color, shape;

        if (pattern.type === 'bullish') {
            position = 'belowBar';
            color = '#089981'; // Green
            shape = 'arrowUp';
        } else if (pattern.type === 'bearish') {
            position = 'aboveBar';
            color = '#f23645'; // Red
            shape = 'arrowDown';
        } else {
            // Neutral (Doji)
            position = 'inBar';
            color = '#8a939f'; // Gray
            shape = 'circle';
        }

        return {
            time: pattern.time,
            position: position,
            color: color,
            shape: shape,
            text: pattern.name
        };
    });

    // Markers must be sorted by time ascending
    markers.sort((a, b) => a.time - b.time);
    candlestickSeries.setMarkers(markers);
}

function renderTable() {
    resultsBody.innerHTML = '';

    if (detectedPatterns.length === 0) {
        resultsBody.innerHTML = '<tr><td colspan="4" style="text-align: center;">No patterns detected</td></tr>';
        return;
    }

    // Sort descending by time so latest are on top
    const sortedPatterns = [...detectedPatterns].sort((a, b) => b.time - a.time);

    sortedPatterns.forEach(pattern => {
        const row = document.createElement('tr');

        // Format Date
        let dateStr = "";
        if (typeof pattern.time === 'number') {
            // Unix timestamp in seconds
            const date = new Date(pattern.time * 1000);
            dateStr = date.toLocaleString();
        } else if (typeof pattern.time === 'object' && pattern.time.year) {
             // Lightweight charts business day format
             dateStr = `${pattern.time.year}-${String(pattern.time.month).padStart(2, '0')}-${String(pattern.time.day).padStart(2, '0')}`;
        } else {
            dateStr = pattern.time;
        }

        // Format Type Class
        const typeClass = pattern.type === 'bullish' ? 'type-bullish' : (pattern.type === 'bearish' ? 'type-bearish' : '');
        const typeLabel = pattern.type.charAt(0).toUpperCase() + pattern.type.slice(1);

        row.innerHTML = `
            <td>${dateStr}</td>
            <td>${pattern.name}</td>
            <td class="${typeClass}">${typeLabel}</td>
            <td>${pattern.price.toFixed(2)}</td>
        `;

        resultsBody.appendChild(row);
    });
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    initChart(); // Create empty chart on load
});

fetchDataBtn.addEventListener('click', fetchBinanceData);
csvFileInput.addEventListener('change', handleCsvUpload);
