// --- 設定データ ---
const STAGE_DATA = {
    1: { distance: 100000000, name: "惑星インハレスへの旅路" },
    2: { distance: 150000000, name: "惑星エクセールへ" },
    3: { distance: 300000000, name: "惑星プネウマへ" }
};

const STATE = {
    INIT: 0,
    WAIT_DB: 0.5,
    COUNTDOWN: 1,
    FUELING: 2,
    FLYING: 3,
    RESULT: 4,
    PAUSED: 5
};

let currentState = STATE.INIT;
let lastState = STATE.INIT;
let audioContext, analyser, dataArray, microphone;
let isMicActive = false;

let currentStageNum = 1;
let goalDistance = 100000000;
let currentCostId = null; 

let fuelSeconds = 0;       
let chargedFuelSeconds = 0; 
let flightDistance = 0;    
let totalDistance = 0;     

// ★修正: 計算ロジック
// 飛距離 = (fuelSeconds * FLIGHT_SPEED)
const FLIGHT_SPEED = 500000; 

// 燃料タンクの表示最大値 (あくまでバーの表示用)
const MAX_FUEL_SEC = 20;

// アニメーション時間倍率 (1秒の燃料で何秒飛ぶか)
// 2なら、1秒吹くと2秒かけて飛ぶ
const FLIGHT_ANIMATION_TIME_MULTIPLIER = 2;

let hasStartedBlowing = false; 
let fuelingDone = false;       

// 時間管理用
let lastFrameTime = 0;

// 音声認識設定
const THOUSAND_INDEX = 24;
let micConfig = {
    noiseThreshold: 0.05, 
    paProfile: [0.032, 0.041, 0.014, 0.022, 0.009, 0.017, 0.005, 0.022, 0.011, 0.010, 0.029, 0.092, 0.135, 0.139, 0.051, 0.013, 0.009, 0.012, 0.014, 0.014, 0.008, 0.009, 0.017, 0.007]
};

const savedConfig = localStorage.getItem('mic_config_v2');
if(savedConfig) {
    try { micConfig = JSON.parse(savedConfig); } catch(e) {}
}

const els = {
    bg: document.getElementById('gameBg'),
    rocket: document.getElementById('rocket'),
    msgArea: document.getElementById('messageArea'),
    fuelTime: document.getElementById('fuelTime'),
    fuelBar: document.getElementById('fuelBar'),
    remainDist: document.getElementById('remainDist'),
    micLevel: document.getElementById('micLevel'),
    paBtn: document.getElementById('paBtn'),
    gameLayer: document.getElementById('gameLayer'),
    modal: document.getElementById('resultModal'),
    resDist: document.getElementById('resultDist'),
    totalDistDisplay: document.getElementById('totalDistDisplay'),
    cdOverlay: document.getElementById('countdownOverlay'),
    cdText: document.getElementById('countdownText'),
    mapMarker: document.getElementById('mapMarker'),
    bgm: document.getElementById('bgm'),
    gameHeader: document.getElementById('gameHeader'),
    stageNameDisplay: document.getElementById('stageNameDisplay'),
    pauseModal: document.getElementById('pauseModal'),
    retryBtn: document.getElementById('retryBtn'),
    celOverlay: document.getElementById('celebrationOverlay'),
    guide: document.getElementById('tacticalGuide')
};

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const stageParam = urlParams.get('stage');
    currentCostId = urlParams.get('cost');

    if (stageParam && STAGE_DATA[stageParam]) {
        currentStageNum = parseInt(stageParam);
    }
    goalDistance = STAGE_DATA[currentStageNum].distance;
    els.stageNameDisplay.innerText = STAGE_DATA[currentStageNum].name;

    consumeMonsterAndLoad(currentCostId);
});

async function consumeMonsterAndLoad(costId) {
    currentState = STATE.WAIT_DB;
    
    if (window.DB && window.DB.load && window.DB.consumeAndStart) {
        totalDistance = await window.DB.load();
        updateDistanceDisplay();

        if(costId && !window.isRetry) {
            await window.DB.consumeAndStart(costId);
        } else {
            window.readyToStart = true;
        }

        if(window.readyToStart) {
            els.msgArea.innerHTML = '<p>エネルギー充填完了！<br>準備完了を押してください</p><button onclick="initGame()" class="pixel-btn start-btn">準備完了</button>';
            currentState = STATE.INIT;
        }
    }
}

window.tryRetry = async function() {
    els.retryBtn.disabled = true;
    els.retryBtn.innerText = "確認中...";

    if(window.DB.checkInventory) {
        const hasStock = await window.DB.checkInventory(currentCostId);
        if(!hasStock) {
            alert("モンスターがいません！惑星に戻って捕獲してください。");
            location.href = "stage_select.html";
            return;
        }
    }

    if(window.DB.consumeAndStart) {
        const success = await window.DB.consumeAndStart(currentCostId);
        if(!success) {
            alert("通信エラーが発生しました");
            return;
        }
    }

    window.isRetry = true; 
    els.modal.classList.add('hidden');
    els.gameHeader.style.display = 'flex';
    
    fuelingDone = false;
    hasStartedBlowing = false;
    fuelSeconds = 0;
    chargedFuelSeconds = 0; 
    flightDistance = 0;
    lastFrameTime = 0; // ★時間をリセット

    els.retryBtn.disabled = false;
    els.retryBtn.innerText = "力を借りて再出発";

    els.fuelTime.innerText = "0.00";
    els.fuelBar.style.width = "0%";
    
    els.bg.classList.remove('speed-stop');
    startCountdown();
};

async function initGame() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);
        analyser.fftSize = 1024; 
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        isMicActive = true;
        
        els.msgArea.style.display = 'none';
        els.bgm.pause();
        els.bgm.currentTime = 0;
        startCountdown();
    } catch (err) {
        alert("マイクの使用が許可されませんでした。");
    }
}

function startCountdown() {
    currentState = STATE.COUNTDOWN;
    els.cdOverlay.classList.remove('hidden');
    els.guide.innerHTML = '<span class="guide-sub">準備</span><span class="guide-big" style="font-size:32px">息を大きく吸って...</span>';
    els.guide.classList.remove('hidden');
    let count = 3;
    els.cdText.innerText = count;
    playBlipSound(600); 

    const timer = setInterval(() => {
        count--;
        if (count > 0) {
            els.cdText.innerText = count;
            playBlipSound(600);
            els.cdText.style.animation = 'none';
            els.cdText.offsetHeight; 
            els.cdText.style.animation = 'popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        } else {
            clearInterval(timer);
            els.cdOverlay.classList.add('hidden');
            currentState = STATE.FUELING;
            els.paBtn.innerText = "ぱっ！と言って発射"; 
            els.paBtn.disabled = true;
            playBlipSound(1000); 
            els.guide.innerHTML = '<span class="guide-sub">燃料注入</span><span class="guide-big">ふ〜〜〜っと<br>長く吹こう！</span>';
            
            // ★ゲームループ開始（タイムスタンプ付き）
            lastFrameTime = 0; 
            requestAnimationFrame(gameLoop);
        }
    }, 1000);
}

window.togglePause = function() {
    if (currentState === STATE.PAUSED) {
        currentState = lastState;
        els.pauseModal.classList.add('hidden');
        lastFrameTime = 0; // ★再開時に時間をリセットして飛び跳ね防止
        if (currentState === STATE.FLYING) {
            els.bgm.play();
            els.bg.classList.remove('speed-stop');
        }
    } else {
        if (currentState === STATE.RESULT || currentState === STATE.WAIT_DB) return;
        lastState = currentState;
        currentState = STATE.PAUSED;
        els.pauseModal.classList.remove('hidden');
        els.bgm.pause();
        els.bg.classList.add('speed-stop');
    }
};

// ★修正: timestampを受け取り、実時間(deltaTime)を計算
function gameLoop(timestamp) {
    if (currentState === STATE.PAUSED) {
        requestAnimationFrame(gameLoop);
        return;
    }

    // 初回フレーム、またはポーズ復帰直後は差分計算をスキップ
    if (!lastFrameTime) {
        lastFrameTime = timestamp;
        requestAnimationFrame(gameLoop);
        return;
    }

    // 経過時間 (秒)
    const deltaTime = (timestamp - lastFrameTime) / 1000;
    lastFrameTime = timestamp;

    if (!isMicActive) return;
    analyser.getByteFrequencyData(dataArray);
    
    let sum = 0;
    let max_amplitude = 0;
    for(let i=0; i<dataArray.length; i++) sum += dataArray[i];
    
    for(let i=0; i<THOUSAND_INDEX; i++) {
        const val = dataArray[i] / 255.0;
        if(val > max_amplitude) max_amplitude = val;
    }

    let highFreqEnergy = 0;
    for(let i=30; i<100; i++) highFreqEnergy += dataArray[i];
    const highFreqAvg = highFreqEnergy / 70;

    let visualLevel = Math.min(100, (max_amplitude / micConfig.noiseThreshold) * 30); 
    els.micLevel.style.width = visualLevel + '%';
    
    const isOverThreshold = max_amplitude > micConfig.noiseThreshold;
    els.micLevel.style.backgroundColor = isOverThreshold ? '#2ecc71' : '#555';

    if (currentState === STATE.FUELING) {
        const isBlowing = isOverThreshold && (highFreqAvg > 10);
        processFueling(isBlowing, deltaTime); // ★deltaTimeを渡す
    } else if (currentState === STATE.FLYING) {
        processFlying(deltaTime); // ★deltaTimeを渡す
    }
    
    requestAnimationFrame(gameLoop);
}

function analyzeVoice(maxAmp) {
    if (maxAmp < micConfig.noiseThreshold) return null;

    let Pa_euclid = 0;
    for (let i = 0; i < THOUSAND_INDEX; i++) {
        const spectrumVal = dataArray[i] / 255.0; 
        Pa_euclid += Math.pow(micConfig.paProfile[i] - spectrumVal, 2);
    }
    const Pa_odds = 1 / (1 + Math.sqrt(Pa_euclid));
    
    if (Pa_odds >= 0.70) return "ぱっ";
    return null;
}

// ★修正: deltaTimeを使って正確に加算
function processFueling(isBlowing, deltaTime) {
    if (fuelingDone) {
        let maxAmp = 0;
        for(let i=0; i<THOUSAND_INDEX; i++) if(dataArray[i]/255.0 > maxAmp) maxAmp = dataArray[i]/255.0;
        
        const recognized = analyzeVoice(maxAmp);
        if (recognized === "ぱっ") {
            launchRocket();
        }
        return;
    }

    if (isBlowing) {
        if (!hasStartedBlowing) hasStartedBlowing = true;
        
        // 1/60 ではなく 実時間(deltaTime) を足す
        fuelSeconds += deltaTime; 
        
        chargedFuelSeconds = fuelSeconds; 
        els.fuelTime.innerText = fuelSeconds.toFixed(2);
        
        let barPercent = (fuelSeconds / MAX_FUEL_SEC) * 100;
        if (fuelSeconds > MAX_FUEL_SEC) {
            barPercent = 100;
            els.fuelBar.classList.add('overcharge');
        } else {
            els.fuelBar.classList.remove('overcharge');
        }
        els.fuelBar.style.width = barPercent + '%';
        if (!els.guide.classList.contains('hidden')) {
             els.guide.classList.add('hidden');
        }

    } else {
        if (hasStartedBlowing) {
            fuelingDone = true;
            els.paBtn.disabled = false;
            els.paBtn.innerText = "「ぱっ！」と言って発射";
            els.paBtn.style.backgroundColor = "#e74c3c";
            els.paBtn.onclick = launchRocket;
            els.fuelBar.classList.remove('overcharge');
            
            // ★追加: 発射指示を表示！
            els.guide.innerHTML = '<span class="guide-sub">準備完了！</span><span class="guide-big" style="color:#e74c3c">「ぱっ！」<br>で発射！</span>';
            els.guide.classList.remove('hidden');

            playBlipSound(800);
        }
    }
}

function launchRocket() {
    els.guide.classList.add('hidden');
    currentState = STATE.FLYING;
    flightDistance = 0; 
    els.bgm.currentTime = 0;
    els.bgm.volume = 0.3;
    els.bgm.play();
    els.paBtn.innerText = "航行中...";
    els.paBtn.style.backgroundColor = "#2980b9";
    els.paBtn.onclick = null; 
    els.bg.classList.remove('speed-stop');
    els.bg.classList.add('speed-fast');
    document.body.classList.add('flying');
    
    lastFrameTime = 0; // 飛行開始時に時間リセット
}

// ★修正: deltaTimeを使って正確に計算
function processFlying(deltaTime) {
    // 速度 = 基本速度 / 倍率
    const speedPerSec = FLIGHT_SPEED / FLIGHT_ANIMATION_TIME_MULTIPLIER;
    const distDelta = speedPerSec * deltaTime;
    
    flightDistance += distDelta;   
    totalDistance += distDelta;
    
    // 燃料消費 = 経過時間 / 倍率
    fuelSeconds -= (deltaTime / FLIGHT_ANIMATION_TIME_MULTIPLIER);

    if (fuelSeconds <= 0) {
        fuelSeconds = 0;
        finishFlight();
    }
    els.fuelTime.innerText = fuelSeconds.toFixed(2);
    els.fuelBar.style.width = Math.min(100, (fuelSeconds / MAX_FUEL_SEC) * 100) + '%';
    updateDistanceDisplay();
}

function updateDistanceDisplay() {
    let remain = Math.max(0, goalDistance - totalDistance);
    els.remainDist.innerText = Math.floor(remain).toLocaleString();
    updateMap();
}

async function finishFlight() {
    currentState = STATE.RESULT;
    document.body.classList.remove('flying');
    els.bg.classList.remove('speed-fast');
    els.bg.classList.add('speed-stop');
    els.gameHeader.style.display = 'none';
    els.bgm.pause();

    // ★修正: ゴール判定
    const isGoal = totalDistance >= goalDistance;

    if (isGoal) {
        // --- ゴール時 ---
        playWinSound(); // ファンファーレ
    } else {
        // --- 燃料切れ時 ---
        playEngineStallSound(); // エンジン停止音
    }

    try {
        await saveGameData(); 
    } catch (e) { console.error(e); }

    // インベントリ確認などは通常時のみ必要（ゴールしたら再挑戦ボタンは出さないため）
    if (!isGoal && window.DB && window.DB.getInventoryCount && currentCostId) {
        const count = await window.DB.getInventoryCount(currentCostId);
        const stockEl = document.getElementById('currentStock');
        if(stockEl) stockEl.innerText = count;
        
        if(count < 1) {
            els.retryBtn.disabled = true;
            els.retryBtn.innerText = "所持なし";
            els.retryBtn.style.backgroundColor = "#555";
        }
    }

    // ★分岐: ゴールならお祝い、ダメなら通常リザルト
    if (isGoal) {
        els.celOverlay.classList.remove('hidden');
    } else {
        els.resDist.innerText = Math.floor(flightDistance).toLocaleString(); 
        els.totalDistDisplay.innerText = Math.floor(totalDistance).toLocaleString(); 
        els.modal.classList.remove('hidden');
    }
}

async function saveGameData() {
    const newLog = {
        date: new Date().toISOString(),
        fuelDuration: parseFloat(chargedFuelSeconds.toFixed(2)),
        distance: Math.floor(flightDistance)
    };
    if (window.DB && window.DB.save) {
        await window.DB.save(newLog, totalDistance);
    }
}

function updateMap() {
    let progress = totalDistance / goalDistance;
    if (progress > 1) progress = 1;
    els.mapMarker.style.bottom = (progress * 100) + '%';
}
function playBlipSound(freq) {
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioContext.currentTime);
    gain.gain.setValueAtTime(0.1, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.1);
}
function playEngineStallSound() {
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(10, audioContext.currentTime + 0.8);
    gain.gain.setValueAtTime(0.3, audioContext.currentTime);
    gain.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.8);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.8);
}

function playWinSound() {
    if (!audioContext) return;
    
    const now = audioContext.currentTime;
    // ド・ミ・ソ・高いド のアルペジオ
    const notes = [261.63, 329.63, 392.00, 523.25]; 
    
    notes.forEach((freq, i) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        
        osc.type = 'triangle'; // 明るい音色
        osc.frequency.value = freq;
        
        // タイミングをずらして再生 (0.1秒ごと)
        const startTime = now + (i * 0.1);
        
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.2, startTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.6);
        
        osc.connect(gain);
        gain.connect(audioContext.destination);
        
        osc.start(startTime);
        osc.stop(startTime + 0.6);
    });

    // 最後のジャーン！
    setTimeout(() => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = 'square'; // 力強い音
        osc.frequency.value = 523.25; // 高いド
        
        const finalTime = audioContext.currentTime;
        gain.gain.setValueAtTime(0.2, finalTime);
        gain.gain.exponentialRampToValueAtTime(0.001, finalTime + 1.5);
        
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.start(finalTime);
        osc.stop(finalTime + 1.5);
    }, 400);
}