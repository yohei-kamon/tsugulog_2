/**
 * TsuguLog: 製造技術承継プラットフォーム 
 * AI解析 & 採点ロジック (正規化と時間補正は計算のみに使用)
 */

import { PoseLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";

if (!window.poseLandmarker) window.poseLandmarker = undefined;
let aiActive = false, isAnalyzed = false, animationId = null, cumulativeMs = 0;
let poseData = []; // [{ time: 0, poses: [raw_lm1, raw_lm2], normPoses: [norm_lm1, norm_lm2] }]

// 正規化用計算
const calcDist = (p1, p2) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));

function getNormalizedPose(landmarks) {
    if (!landmarks || landmarks.length < 25) return landmarks;
    const center = {
        x: (landmarks[11].x + landmarks[12].x + landmarks[23].x + landmarks[24].x) / 4,
        y: (landmarks[11].y + landmarks[12].y + landmarks[23].y + landmarks[24].y) / 4
    };
    const scale = (calcDist(landmarks[11], landmarks[23]) + calcDist(landmarks[12], landmarks[24])) / 2 || 1;
    return landmarks.map(p => ({ x: (p.x - center.x) / scale, y: (p.y - center.y) / scale, z: p.z / scale }));
}

async function initPoseDetection() {
    const v1 = document.getElementById('video1'), c1 = document.getElementById('canvas1');
    const toggleBtn = document.getElementById('toggleAI'), resetBtn = document.getElementById('resetAI');
    if (!v1 || !toggleBtn) return;

    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
    window.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task`, delegate: "GPU" },
        runningMode: "VIDEO", numPoses: 2
    });

    toggleBtn.addEventListener('click', async () => {
        if (!isAnalyzed) {
            toggleBtn.disabled = true;
            document.getElementById('stats-overlay').classList.remove('d-none');
            
            // 解析実行
            poseData = await analyzeVideo(v1);
            
            // 採点計算：正規化データのみをサーバーへ送信
            const dtwRes = await fetch('/analyze/dtw', {
                method: 'POST', 
                headers: {'Content-Type': 'application/json', 'X-CSRFToken': document.getElementById('csrf_token').value},
                body: JSON.stringify({ normPoseData: poseData.map(d => ({time: d.time, poses: d.normPoses})) })
            }).then(r => r.json());

            if (dtwRes.dtw_score !== undefined) {
                document.getElementById('overall-dtw-card').classList.remove('d-none');
                document.getElementById('dtw-score-val').innerText = dtwRes.dtw_score;
                document.getElementById('dtw-score-bar').style.width = `${dtwRes.dtw_score}%`;
                document.getElementById('avg-cosine-val').innerText = dtwRes.avg_cosine.toFixed(4);
                document.getElementById('avg-euclidean-val').innerText = dtwRes.avg_euclidean.toFixed(4);
                document.getElementById('dtw-feedback').innerText = dtwRes.feedback;
                const bar = document.getElementById('dtw-score-bar');
                bar.className = `progress-bar ${dtwRes.dtw_score > 80 ? 'bg-success' : dtwRes.dtw_score > 50 ? 'bg-warning' : 'bg-danger'}`;
            }

            isAnalyzed = true; toggleBtn.disabled = false;
            resetBtn?.classList.remove('d-none');
            document.getElementById('download-area')?.classList.remove('d-none');
            document.getElementById('stats-overlay').classList.add('d-none');
            toggleBtn.innerHTML = '<i class="fa-solid fa-play"></i> 解析表示 ON';
        }
        aiActive = !aiActive;
        toggleBtn.classList.toggle('btn-warning'); toggleBtn.classList.toggle('btn-success');
        if (aiActive) renderLoop();
    });

    async function analyzeVideo(video) {
        const data = [], step = 0.1, duration = video.duration;
        video.pause();
        for (let t = 0; t <= duration; t += step) {
            video.currentTime = t;
            await new Promise(r => { video.onseeked = r; setTimeout(r, 1000); });
            const prog = Math.min(100, Math.round((t / duration) * 100));
            document.getElementById('progress-percent').innerText = `${prog}%`;
            document.getElementById('analysis-progress-bar').style.width = `${prog}%`;

            const res = window.poseLandmarker.detectForVideo(video, cumulativeMs);
            cumulativeMs += 100;
            if (res.landmarks) {
                // 生データ(描画用)と正規化データ(計算用)を両方保存
                data.push({ 
                    time: t.toFixed(2), 
                    poses: JSON.parse(JSON.stringify(res.landmarks)), // 生の座標
                    normPoses: res.landmarks.map(l => getNormalizedPose(l)) // 正規化済み座標
                });
            }
        }
        return data;
    }

    function renderLoop() {
        if (!aiActive) return;
        const idx = poseData.findIndex(d => d.time >= v1.currentTime);
        const rawPoses = idx === -1 ? null : poseData[idx].poses; // 生データを取得
        if (rawPoses) {
            c1.width = c1.clientWidth; c1.height = c1.clientHeight;
            const ctx = c1.getContext('2d');
            ctx.clearRect(0, 0, c1.width, c1.height);
            const du = new DrawingUtils(ctx);
            rawPoses.forEach((lm, i) => {
                // 描画は元の映像座標（生データ）で実施
                du.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, {color: i===0?'#00FF00':'#00BFFF', lineWidth: 2});
                du.drawLandmarks(lm, {color: '#FF0000', radius: 2});
            });
        }
        animationId = requestAnimationFrame(renderLoop);
    }
}

window.clearAllAnalysis = () => location.reload();
document.addEventListener('DOMContentLoaded', initPoseDetection);
