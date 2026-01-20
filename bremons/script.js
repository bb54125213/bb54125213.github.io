// ★ バージョン一括管理
const GAME_VERSION = "6.4.4";

document.addEventListener('DOMContentLoaded', () => {
    // 画面内の .version クラスを持つ要素をすべて書き換える
    const verEls = document.querySelectorAll('.version');
    verEls.forEach(el => {
        el.innerText = "Ver " + GAME_VERSION;
    });
});

document.addEventListener('DOMContentLoaded', () => {
    
    // BGMの再生（ユーザー操作が必要な場合があるため、クリックでも発火するようにする）
    initAudio();

    // メニュー画面でのみ実行する処理
    if (document.querySelector('.menu-screen')) {
        spawnMonsters(15); // モンスターを15匹に増量
        startMeteoRain();   
    }

    // ステージ選択画面でも背景演出を入れたい場合は以下
    if (document.querySelector('.stage-select-screen')) {
        // ステージ画面ではモンスター少なめにするなどの調整も可能
        spawnMonsters(5); 
    }
});

// --- BGM管理 ---
function initAudio() {
    const bgm = document.getElementById('bgm');
    if (!bgm) return;

    bgm.volume = 0.3; // 音量を少し下げる（30%）

    // 自動再生を試みる
    const playPromise = bgm.play();

    if (playPromise !== undefined) {
        playPromise.catch(error => {
            console.log("自動再生がブロックされました。ユーザー操作を待ちます。");
            // 画面のどこかをクリックしたら再生開始
            document.body.addEventListener('click', () => {
                bgm.play();
            }, { once: true });
        });
    }
}

// --- モンスター生成 ---
function spawnMonsters(count) {
    const layer = document.getElementById('floatingLayer');
    if (!layer) return; // レイヤーが無いページでは何もしない

    const monsterImages = ['./nightgame/blue.png', './nightgame/red.png', './nightgame/yellow.png'];

    for (let i = 0; i < count; i++) {
        const img = document.createElement('img');
        img.src = monsterImages[Math.floor(Math.random() * monsterImages.length)];
        img.classList.add('floater');
        
        // ランダムな位置
        img.style.left = Math.random() * 90 + '%';
        img.style.top = Math.random() * 90 + '%';
        
        // ランダムな大きさ (20px ~ 70px)
        const size = Math.random() * 50 + 20;
        img.style.width = size + 'px';

        // ランダムなアニメーション設定
        // duration: 回転の速さ
        const duration = Math.random() * 10 + 5; // 5秒〜15秒
        // delay: 開始のタイミング
        const delay = Math.random() * 5;
        // direction: 時計回りか反時計回りか
        const direction = Math.random() > 0.5 ? 'normal' : 'reverse';

        // CSSアニメーションを適用
        img.style.animation = `floatRotateMain ${duration}s linear infinite ${direction}`;
        img.style.animationDelay = `-${delay}s`; // 最初から動いているように見せるためマイナス指定

        layer.appendChild(img);
    }
}

// --- 隕石生成 (前回と同じ) ---
function startMeteoRain() {
    const layer = document.getElementById('floatingLayer');
    if(!layer) return;

    function createMeteo() {
        const meteo = document.createElement('img');
        meteo.src = './nightgame/meteo.png';
        meteo.classList.add('meteo');

        const startSide = Math.random(); 
        let startX, startY;

        if (startSide < 0.5) { 
            startX = Math.random() * window.innerWidth;
            startY = -100;
        } else if (startSide < 0.75) { 
            startX = -100;
            startY = Math.random() * (window.innerHeight / 2);
        } else { 
            startX = window.innerWidth + 100;
            startY = Math.random() * (window.innerHeight / 2);
        }

        const endX = Math.random() * window.innerWidth;
        const endY = window.innerHeight + 100;

        const angleRad = Math.atan2(endY - startY, endX - startX);
        const angleDeg = angleRad * (180 / Math.PI) - 90;

        meteo.style.left = startX + 'px';
        meteo.style.top = startY + 'px';
        meteo.style.width = (Math.random() * 40 + 20) + 'px'; 
        meteo.style.transform = `rotate(${angleDeg}deg)`; 
        
        const duration = Math.random() * 2000 + 2000; 

        const animation = meteo.animate([
            { transform: `translate(0, 0) rotate(${angleDeg}deg)` },
            { transform: `translate(${endX - startX}px, ${endY - startY}px) rotate(${angleDeg}deg)` }
        ], {
            duration: duration,
            easing: 'linear',
            fill: 'forwards'
        });

        layer.appendChild(meteo);

        animation.onfinish = () => {
            meteo.remove();
        };
    }

    setInterval(createMeteo, 800);
}

// --- 画面遷移 ---
function startGame() {
    window.location.href = "stage_select.html"; 
}
function viewLog() { alert("ログ画面（準備中）"); }
function goOnline() { alert("オンライン対戦（準備中）"); }