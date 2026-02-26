/**
 * TsuguLog: 製造技術承継プラットフォーム 
 * 1動画内2人比較（5秒時点・正規化・類似度解析）
 */

import { PoseLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";

// グローバル変数
if (!window.poseLandmarker) window.poseLandmarker = undefined;
let aiActive = false;
let isAnalyzed = false;
let poseData1 = []; 
let animationId = null;
let cumulativeMs = 0;

/**
 * 1. 数学的比較・正規化ロジック
 */

// 2点間の距離
const calcDist = (p1, p2) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));

// ポーズの正規化（中心合わせ & スケーリング）
function normalizePose(landmarks) {
    // 1. 重心（両肩・両腰の4点の中央）を算出
    const center = {
        x: (landmarks[11].x + landmarks[12].x + landmarks[23].x + landmarks[24].x) / 4,
        y: (landmarks[11].y + landmarks[12].y + landmarks[23].y + landmarks[24].y) / 4
    };
    
    // 2. スケール（体幹：肩から腰の長さの平均）を算出
    const scale = (calcDist(landmarks[11], landmarks[23]) + calcDist(landmarks[12], landmarks[24])) / 2;
    
    // 3. 全座標を正規化（中心を0,0に、体幹を1.0に）
    return landmarks.map(p => ({
        x: (p.x - center.x) / scale,
        y: (p.y - center.y) / scale,
        z: p.z / scale
    }));
}

// 5秒時点の2人比較診断を実行
function evaluateAt5Seconds(poses) {
    if (poses.length < 2) {
        console.warn("比較対象が2人見つかりませんでした。");
        return;
    }

    // 両者のポーズを正規化
    const p1 = normalizePose(poses[0]);
    const p2 = normalizePose(poses[1]);

    // 比較する主要関節（肩、肘、手首、腰、膝、足首）
    const joints = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    let euclideanSum = 0;

    joints.forEach(i => {
        // コサイン類似度用
        dotProduct += (p1[i].x * p2[i].x) + (p1[i].y * p2[i].y);
        normA += Math.pow(p1[i].x, 2) + Math.pow(p1[i].y, 2);
        normB += Math.pow(p2[i].x, 2) + Math.pow(p2[i].y, 2);

        // ユークリッド距離用
        euclideanSum += Math.pow(p1[i].x - p2[i].x, 2) + Math.pow(p1[i].y - p2[i].y, 2);
    });

    const cosineSim = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    const euclideanDist = Math.sqrt(euclideanSum) / joints.length;

    // UIへ反映
    document.getElementById('five-sec-eval-card').classList.remove('d-none');
    document.getElementById('eval-cosine').innerText = cosineSim.toFixed(3);
    document.getElementById('eval-euclidean').innerText = euclideanDist.toFixed(3);

    let feedback = "";
    if (cosineSim > 0.96) feedback = "【極めて優秀】動作の角度・方向がほぼ完璧に一致しています。技術の完全なトレースが確認されました。";
    else if (cosineSim > 0.88) feedback = "【良好】基本の型は一致していますが、肘や膝の角度にわずかな差異があります。微調整を推奨します。";
    else feedback = "【要改善】重心または関節の向きに大きな乖離があります。ベテランの初動動作を再確認してください。";
    
    document.getElementById('eval-feedback').innerText = feedback;
}

/**
 * 2. 解析・描画エンジン
 */
async function initializePoseLandmarker() {
    if (window.poseLandmarker) return;
    try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
        window.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task`,
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numPoses: 2
        });
    } catch (e) { console.error("MediaPipe Init Error", e); }
}

async function initPoseDetection() {
    const v1 = document.getElementById('video1');
    const c1 = document.getElementById('canvas1');
    const toggleBtn = document.getElementById('toggleAI');
    const resetBtn = document.getElementById('resetAI');

    if (!v1 || !toggleBtn) return;

    await initializePoseLandmarker();

    toggleBtn.addEventListener('click', async () => {
        if (!isAnalyzed) {
            toggleBtn.disabled = true;
            document.getElementById('stats-overlay')?.classList.remove('d-none');

            // 解析実行
            poseData1 = await analyzeVideo(v1, "技術解析中");

            // ★ 解析完了後、5.0秒時点のデータを探して診断
            const fiveSecData = poseData1.find(d => parseFloat(d.time) >= 5.0);
            if (fiveSecData) evaluateAt5Seconds(fiveSecData.poses);

            isAnalyzed = true;
            toggleBtn.disabled = false;
            resetBtn?.classList.remove('d-none');
            document.getElementById('download-area')?.classList.remove('d-none');
            document.getElementById('stats-overlay')?.classList.add('d-none');
            toggleBtn.innerHTML = '<i class="fa-solid fa-play"></i> 解析表示 ON';
        }
        aiActive = !aiActive;
        toggleBtn.classList.toggle('btn-warning');
        toggleBtn.classList.toggle('btn-success');
        if (aiActive) renderLoop();
    });

    async function analyzeVideo(video, label) {
        const data = [];
        const step = 0.1;
        const duration = video.duration;
        const progressBar = document.getElementById('analysis-progress-bar');
        const progressPercent = document.getElementById('progress-percent');

        video.pause();
        for (let t = 0; t <= duration; t += step) {
            video.currentTime = t;
            await new Promise(r => {
                const timer = setTimeout(r, 1000);
                video.onseeked = () => { clearTimeout(timer); r(); };
            });

            const progress = Math.min(100, Math.round((t / duration) * 100));
            if (progressBar) progressBar.style.width = `${progress}%`;
            if (progressPercent) progressPercent.innerText = `${progress}%`;

            const result = window.poseLandmarker.detectForVideo(video, cumulativeMs);
            cumulativeMs += 100;

            if (result && result.landmarks) {
                data.push({ time: t.toFixed(2), poses: JSON.parse(JSON.stringify(result.landmarks)) });
            }
        }
        video.currentTime = 0;
        return data;
    }

    function renderLoop() {
        if (!aiActive) return;
        const poses = getPoseAtTime(poseData1, v1.currentTime);
        drawPoses(c1, poses);
        animationId = requestAnimationFrame(renderLoop);
    }

    function drawPoses(canvas, poses) {
        if (!canvas || !poses) return;
        const ctx = canvas.getContext('2d');
        canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const drawingUtils = new DrawingUtils(ctx);
        poses.forEach((landmarks, idx) => {
            const color = idx === 0 ? '#00FF00' : '#00BFFF';
            drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, { color: color, lineWidth: 2 });
            drawingUtils.drawLandmarks(landmarks, { color: '#FF0000', lineWidth: 1, radius: 2 });
        });
    }

    function getPoseAtTime(data, time) {
        if (!data || data.length === 0) return null;
        let idx = data.findIndex(d => d.time >= time);
        return data[idx === -1 ? data.length - 1 : idx].poses;
    }
}

/**
 * 3. 初期化・リセット
 */
window.clearAllAnalysis = function() {
    if (animationId) cancelAnimationFrame(animationId);
    aiActive = false; isAnalyzed = false; poseData1 = [];
    document.getElementById('five-sec-eval-card')?.classList.add('d-none');
    const toggleBtn = document.getElementById('toggleAI');
    if (toggleBtn) {
        toggleBtn.disabled = false;
        toggleBtn.className = "btn btn-sm btn-warning shadow";
        toggleBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> AI解析 実行';
    }
    const c1 = document.getElementById('canvas1');
    if (c1) c1.getContext('2d').clearRect(0, 0, c1.width, c1.height);
};

// CSV保存
window.downloadCSV = function() { /* 前回実装済みの downloadAsCSV ロジック */ };

document.addEventListener('DOMContentLoaded', () => {
    initPoseDetection();
    // 他の同期系関数
});
