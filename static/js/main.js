/**
 * TsuguLog: 製造技術承継プラットフォーム 
 * MediaPipe Tasks API (ES Module版) - CSV保存機能付
 */

import { PoseLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";

// グローバル状態
if (!window.poseLandmarker) window.poseLandmarker = undefined;
let aiActive = false;
let isAnalyzed = false;
let poseData1 = []; 
let poseData2 = [];
let animationId = null;
let cumulativeMs = 0;

// MediaPipe 関節名マッピング
const LANDMARK_NAMES = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner", "right_eye", "right_eye_outer",
    "left_ear", "right_ear", "mouth_left", "mouth_right", "left_shoulder", "right_shoulder", "left_elbow",
    "right_elbow", "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index", "right_index",
    "left_thumb", "right_thumb", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle",
    "left_heel", "right_heel", "left_foot_index", "right_foot_index"
];

/**
 * 1. AIライブラリ初期化
 */
async function initializePoseLandmarker() {
    if (window.poseLandmarker) return;
    try {
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        window.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task`,
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numPoses: 2
        });
        console.log("AIライブラリの準備完了");
    } catch (error) {
        console.error("AI初期化エラー:", error);
    }
}

/**
 * 2. 状態リセット
 */
window.clearAllAnalysis = function() {
    if (animationId) cancelAnimationFrame(animationId);
    aiActive = false;
    isAnalyzed = false;
    poseData1 = [];
    poseData2 = [];

    const toggleBtn = document.getElementById('toggleAI');
    if (toggleBtn) {
        toggleBtn.disabled = false;
        toggleBtn.className = "btn btn-sm btn-warning shadow";
        toggleBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> AI解析 実行';
    }
    document.getElementById('resetAI')?.classList.add('d-none');
    document.getElementById('stats-overlay')?.classList.add('d-none');
    document.getElementById('download-area')?.classList.add('d-none');

    ['canvas1', 'canvas2'].forEach(id => {
        const c = document.getElementById(id);
        if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    });
};

/**
 * 3. 解析・描画エンジン
 */
async function initPoseDetection() {
    const v1 = document.getElementById('video1');
    const v2 = document.getElementById('video2');
    const c1 = document.getElementById('canvas1');
    const c2 = document.getElementById('canvas2');
    const toggleBtn = document.getElementById('toggleAI');
    const resetBtn = document.getElementById('resetAI');

    if (!v1 || !toggleBtn) return;

    await initializePoseLandmarker();

    resetBtn?.addEventListener('click', () => {
        if (confirm("解析データをリセットしますか？")) window.clearAllAnalysis();
    });

    // CSV保存ボタンのイベント登録
    document.getElementById('downloadCSV1')?.addEventListener('click', () => downloadAsCSV(poseData1, "video1_motion_data.csv"));
    document.getElementById('downloadCSV2')?.addEventListener('click', () => downloadAsCSV(poseData2, "video2_motion_data.csv"));

    toggleBtn.addEventListener('click', async () => {
        if (!isAnalyzed) {
            if (!window.poseLandmarker) return alert("ライブラリ読込中...");
            toggleBtn.disabled = true;
            document.getElementById('stats-overlay')?.classList.remove('d-none');

            poseData1 = await analyzeVideo(v1, "動画1");
            if (v2) {
                if (isNaN(v2.duration) || v2.readyState < 1) await new Promise(r => v2.onloadedmetadata = r);
                poseData2 = await analyzeVideo(v2, "動画2");
                document.getElementById('downloadCSV2')?.classList.remove('d-none');
            }

            isAnalyzed = true;
            toggleBtn.disabled = false;
            resetBtn?.classList.remove('d-none');
            document.getElementById('download-area')?.classList.remove('d-none');
            document.getElementById('analysis-progress-container')?.classList.add('d-none');
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
        const progressLabel = document.getElementById('progress-label');
        const progressBar = document.getElementById('analysis-progress-bar');
        const originalTime = video.currentTime;
        video.pause();

        for (let t = 0; t <= duration; t += step) {
            video.currentTime = t;
            await new Promise(r => {
                const timer = setTimeout(r, 1000);
                video.onseeked = () => { clearTimeout(timer); r(); };
            });

            if (progressLabel) progressLabel.innerText = `${label}: ${t.toFixed(1)}s 解析中`;
            if (progressBar) progressBar.style.width = `${Math.round((t / duration) * 100)}%`;

            try {
                const result = window.poseLandmarker.detectForVideo(video, cumulativeMs);
                cumulativeMs += 100;
                if (result && result.landmarks) {
                    data.push({ time: t.toFixed(2), poses: JSON.parse(JSON.stringify(result.landmarks)) });
                }
            } catch (e) { cumulativeMs += 100; }
        }
        video.currentTime = originalTime;
        return data;
    }

    function renderLoop() {
        if (!aiActive) return;
        const time = v1.currentTime;
        drawPoses(c1, getPoseAtTime(poseData1, time));
        if (v2 && c2) drawPoses(c2, getPoseAtTime(poseData2, time));
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
 * 4. CSV出力ロジック
 */
function downloadAsCSV(data, filename) {
    if (!data || data.length === 0) return alert("データがありません。");

    let csvContent = "timestamp_sec,person_id,landmark_id,landmark_name,x,y,z,visibility\n";

    data.forEach(frame => {
        frame.poses.forEach((pose, personIdx) => {
            pose.forEach((lm, lmIdx) => {
                const row = [
                    frame.time,
                    personIdx,
                    lmIdx,
                    LANDMARK_NAMES[lmIdx],
                    lm.x.toFixed(6),
                    lm.y.toFixed(6),
                    lm.z.toFixed(6),
                    lm.visibility.toFixed(6)
                ].join(",");
                csvContent += row + "\n";
            });
        });
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * 5. 動画同期・その他
 */
function initVideoSync() {
    document.querySelectorAll('.comparison-container').forEach(container => {
        const v1 = container.querySelector('.video-1');
        const v2 = container.querySelector('.video-2');
        if (v1 && v2) {
            v1.addEventListener('play', () => v2.play().catch(()=>{}));
            v1.addEventListener('pause', () => v2.pause());
            v1.addEventListener('seeking', () => v2.currentTime = v1.currentTime);
        }
    });
}

window.toggleLike = async function(postId) {
    const response = await fetch(`/like/${postId}`, {
        method: 'POST',
        headers: { 'X-CSRFToken': document.querySelector('#csrf_token')?.value || '' }
    });
    if (response.ok) {
        const data = await response.json();
        const btnIcon = document.querySelector(`#like-btn-${postId} i`);
        if (data.liked) { btnIcon.classList.replace('fa-regular', 'fa-solid'); btnIcon.classList.add('text-danger'); }
        else { btnIcon.classList.replace('fa-solid', 'fa-regular'); btnIcon.classList.remove('text-danger'); }
    }
};

window.addEventListener('pagehide', window.clearAllAnalysis);
document.addEventListener('DOMContentLoaded', () => {
    initVideoSync();
    initPoseDetection();
});