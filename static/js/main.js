/**
 * 1. 動画の同期再生設定
 */
function initVideoSync() {
    document.querySelectorAll('.comparison-container').forEach(container => {
        const v1 = container.querySelector('.video-1');
        const v2 = container.querySelector('.video-2');
        if (v1 && v2) {
            v1.addEventListener('play', () => v2.play());
            v1.addEventListener('pause', () => v2.pause());
            v1.addEventListener('seeking', () => { v2.currentTime = v1.currentTime; });
            v1.addEventListener('ratechange', () => { v2.playbackRate = v1.playbackRate; });
        }
    });
}

/**
 * 2. Ajaxによるいいね
 */
async function toggleLike(postId) {
    const csrfToken = document.querySelector('#csrf_token')?.value;
    const response = await fetch(`/like/${postId}`, {
        method: 'POST',
        headers: { 'X-CSRFToken': csrfToken || '' }
    });
    if (response.ok) {
        const data = await response.json();
        const btnIcon = document.querySelector(`#like-btn-${postId} i`);
        const countSpan = document.querySelector(`#like-count-${postId}`);
        if (data.liked) { btnIcon.classList.replace('fa-regular', 'fa-solid'); btnIcon.classList.add('text-danger'); }
        else { btnIcon.classList.replace('fa-solid', 'fa-regular'); btnIcon.classList.remove('text-danger'); }
        countSpan.innerText = data.count;
    }
}

/**
 * 3. AI 姿勢解析 (究極安定化ロジック版)
 */
let aiActive = false;
let isAnalyzed = false;
let poseData1 = []; 
let poseData2 = [];
let currentResults = null;
let animationId = null;

// スコア平滑化用のバッファ
let scoreHistory = [];
const SCORE_SMOOTHING_WINDOW = 8; // 直近8フレームの平均を表示

function getDataIndexAtTime(data, time) {
    if (!data || data.length === 0) return -1;
    return data.findIndex(d => d.time >= time);
}

async function initPoseDetection() {
    const v1 = document.getElementById('video1');
    const v2 = document.getElementById('video2');
    const c1 = document.getElementById('canvas1');
    const c2 = document.getElementById('canvas2');
    const toggleBtn = document.getElementById('toggleAI');
    const resetBtn = document.getElementById('resetAI');
    if (!v1 || !c1 || !toggleBtn) return;

    const ctx1 = c1.getContext('2d');
    const ctx2 = c2 ? c2.getContext('2d') : null;

    const pose = new Pose({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
    pose.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    pose.onResults((results) => { currentResults = results; });

    if (resetBtn) {
        resetBtn.addEventListener('click', () => { if (confirm("Reset analysis data?")) clearAllAnalysis(); });
    }

    toggleBtn.addEventListener('click', async () => {
        if (!isAnalyzed) {
            toggleBtn.disabled = true;
            document.getElementById('stats-overlay').classList.remove('d-none');
            if (v1.readyState < 2) await new Promise(r => v1.onloadeddata = r);
            poseData1 = await analyzeVideo(v1, pose, v2 ? "Video 1" : "Video");
            if (v2) {
                await new Promise(r => setTimeout(r, 500));
                if (v2.readyState < 2) await new Promise(r => v2.onloadeddata = r);
                poseData2 = await analyzeVideo(v2, pose, "Video 2");
            }
            isAnalyzed = true;
            toggleBtn.disabled = false;
            if (resetBtn) resetBtn.classList.remove('d-none');
            document.getElementById('analysis-progress-container').classList.add('d-none');
            const statsData = document.getElementById('stats-data');
            if (v2 && statsData) statsData.classList.remove('d-none');
            toggleBtn.innerHTML = '<i class="fa-solid fa-play"></i> Show Pose';
        }
        aiActive = !aiActive;
        toggleBtn.classList.toggle('btn-warning');
        toggleBtn.classList.toggle('btn-success');
        if (aiActive) renderLoop();
    });

    async function analyzeVideo(video, poseInstance, label) {
        const data = [];
        const duration = video.duration;
        const step = 0.1;
        const originalTime = video.currentTime;
        for (let t = 0; t <= duration; t += step) {
            video.currentTime = t;
            await new Promise((resolve) => {
                const timer = setTimeout(resolve, 2000);
                const onSeeked = () => { video.removeEventListener('seeked', onSeeked); clearTimeout(timer); resolve(); };
                video.addEventListener('seeked', onSeeked);
            });
            currentResults = null;
            await poseInstance.send({image: video});
            let poll = 0;
            while (currentResults === null && poll < 50) {
                await new Promise(r => setTimeout(r, 40));
                poll++;
            }
            if (currentResults && currentResults.poseLandmarks) {
                data.push({ time: t, landmarks: JSON.parse(JSON.stringify(currentResults.poseLandmarks)) });
            }
            const progress = Math.round((t / duration) * 100);
            document.getElementById('progress-label').innerText = `${label}: ${t.toFixed(1)}s`;
            document.getElementById('analysis-progress-bar').style.width = `${progress}%`;
            document.getElementById('progress-percent').innerText = `${progress}%`;
        }
        video.currentTime = originalTime;
        return data;
    }

    function renderLoop() {
        if (!aiActive) return;
        const idx = getDataIndexAtTime(poseData1, v1.currentTime);
        if (idx !== -1) {
            const l1 = poseData1[idx].landmarks;
            drawOnCanvas(c1, ctx1, l1);
            if (v2 && ctx2 && poseData2[idx]) {
                const l2 = poseData2[idx].landmarks;
                drawOnCanvas(c2, ctx2, l2);
                comparePosesFinal(l1, l2, c2, ctx2);
            }
        }
        animationId = requestAnimationFrame(renderLoop);
    }

    /**
     * 【究極安定化アルゴリズム】
     */
    function comparePosesFinal(l1, l2, canvas2, ctx2) {
        // 部位別の重み付け (体幹は厳しく、末端はジッターを許容)
        const weights = {
            11: 1.5, 12: 1.5, 23: 1.5, 24: 1.5, // 肩・腰 (安定)
            13: 1.0, 14: 1.0, 25: 1.0, 26: 1.0, // 肘・膝
            15: 0.7, 16: 0.7, 27: 0.7, 28: 0.7  // 手首・足首 (激しく揺れる)
        };

        const getCenter = (l) => ({ x: (l[11].x + l[12].x + l[23].x + l[24].x) / 4, y: (l[11].y + l[12].y + l[23].y + l[24].y) / 4 });
        const getScale = (l) => Math.sqrt(Math.pow(l[11].x - l[24].x, 2) + Math.pow(l[11].y - l[24].y, 2)); // 対角線でスケール計算

        const center1 = getCenter(l1);
        const center2 = getCenter(l2);
        const scale1 = getScale(l1);
        const scale2 = getScale(l2);

        ctx2.beginPath();
        ctx2.strokeStyle = '#FFEB3B';
        ctx2.lineWidth = 2;

        let weightedErrorSum = 0;
        let weightTotal = 0;

        // ノイズ許容閾値 (デッドゾーン)
        const NOISE_THRESHOLD = 0.015; 

        Object.keys(weights).forEach(id => {
            const i = parseInt(id);
            const w = weights[i];

            // 正規化座標
            const n1 = { x: (l1[i].x - center1.x) / scale1, y: (l1[i].y - center1.y) / scale1 };
            const n2 = { x: (l2[i].x - center2.x) / scale2, y: (l2[i].y - center2.y) / scale2 };

            let dist = Math.sqrt(Math.pow(n1.x - n2.x, 2) + Math.pow(n1.y - n2.y, 2));

            // --- デッドゾーン処理: 微小なズレはゼロとみなす ---
            if (dist < NOISE_THRESHOLD) dist = 0;
            else dist -= NOISE_THRESHOLD; // 閾値を超えた分だけをカウント

            weightedErrorSum += dist * w;
            weightTotal += w;

            // 描画
            const x1_p = (n1.x * scale2 + center2.x) * canvas2.width;
            const y1_p = (n1.y * scale2 + center2.y) * canvas2.height;
            ctx2.moveTo(x1_p, y1_p);
            ctx2.lineTo(l2[i].x * canvas2.width, l2[i].y * canvas2.height);
        });
        ctx2.stroke();

        const avgError = weightedErrorSum / weightTotal;
        const rawScore = Math.exp(-avgError * 12) * 100; // 感度を調整

        // --- スコアの移動平均 (Smoothing) ---
        scoreHistory.push(rawScore);
        if (scoreHistory.length > SCORE_SMOOTHING_WINDOW) scoreHistory.shift();
        const smoothedScore = Math.round(scoreHistory.reduce((a, b) => a + b) / scoreHistory.length);

        // 同じ動画なら100%に固定するためのクランプ
        const finalScore = smoothedScore > 98 ? 100 : smoothedScore;

        const sc = document.getElementById('pose-sync-score');
        if (sc) sc.innerText = finalScore;

        // 角度比較 (こちらはジッターの影響を受けにくい)
        const calcA = (p1, p2, p3) => {
            const r = Math.atan2(p3.y - p2.y, p3.x - p2.x) - Math.atan2(p1.y - p2.y, p1.x - p2.x);
            let a = Math.abs(r * 180 / Math.PI);
            return Math.round(a > 180 ? 360 - a : a);
        };
        document.getElementById('elbow-delta').innerText = Math.abs(calcA(l1[12], l1[14], l1[16]) - calcA(l2[12], l2[14], l2[16]));
        document.getElementById('knee-delta').innerText = Math.abs(calcA(l1[24], l1[26], l1[28]) - calcA(l2[24], l2[26], l2[28]));
    }

    function drawOnCanvas(canvas, ctx, landmarks) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (landmarks) {
            drawConnectors(ctx, landmarks, POSE_CONNECTIONS, {color: '#00FF00', lineWidth: 2});
            drawLandmarks(ctx, landmarks, {color: '#FF0000', lineWidth: 1, radius: 2});
        }
    }
}

function clearAllAnalysis() {
    aiActive = false; isAnalyzed = false; poseData1 = []; poseData2 = []; scoreHistory = [];
    if (animationId) cancelAnimationFrame(animationId);
    document.getElementById('toggleAI').innerHTML = '<i class="fa-solid fa-bolt"></i> AI Analyze';
    document.getElementById('stats-overlay').classList.add('d-none');
    const c1 = document.getElementById('canvas1'); const c2 = document.getElementById('canvas2');
    if (c1) c1.getContext('2d').clearRect(0, 0, c1.width, c1.height);
    if (c2) c2.getContext('2d').clearRect(0, 0, c2.width, c2.height);
}

window.addEventListener('pagehide', clearAllAnalysis);
document.addEventListener('DOMContentLoaded', () => {
    initVideoSync();
    initPoseDetection();
});
