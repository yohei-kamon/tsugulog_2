/**
 * TsuguLog: 製造技術承継プラットフォーム 
 * フロントエンド・コアロジック (AI技術解析 & 動作同期)
 */

let aiActive = false;
let isAnalyzed = false;
let poseData1 = []; 
let poseData2 = [];
let currentResults = null; 
let animationId = null;

/**
 * 1. 共通ユーティリティ
 */
function calculateAngle(p1, p2, p3) {
    if (!p1 || !p2 || !p3) return 0;
    const radians = Math.atan2(p3.y - p2.y, p3.x - p2.x) - Math.atan2(p1.y - p2.y, p1.x - p2.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);
    if (angle > 180.0) angle = 360 - angle;
    return Math.round(angle);
}

function getPoseAtTime(data, time) {
    if (!data || data.length === 0) return null;
    let nextIdx = data.findIndex(d => d.time > time);
    if (nextIdx === 0) return data[0].landmarks;
    if (nextIdx === -1) return data[data.length - 1].landmarks;
    return data[nextIdx - 1].landmarks;
}

/**
 * 2. 状態リセット・クリーンアップ
 */
function clearAllAnalysis() {
    aiActive = false;
    isAnalyzed = false;
    poseData1 = [];
    poseData2 = [];
    currentResults = null;

    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    const toggleBtn = document.getElementById('toggleAI');
    const resetBtn = document.getElementById('resetAI');
    const overlay = document.getElementById('stats-overlay');
    const progress = document.getElementById('analysis-progress-container');

    if (toggleBtn) {
        toggleBtn.disabled = false;
        toggleBtn.className = "btn btn-sm btn-warning shadow";
        toggleBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> AI解析 実行';
    }
    if (resetBtn) resetBtn.classList.add('d-none');
    if (overlay) overlay.classList.add('d-none');
    if (progress) {
        progress.classList.remove('d-none');
        const bar = document.getElementById('analysis-progress-bar');
        if (bar) bar.style.width = '0%';
    }

    const c1 = document.getElementById('canvas1');
    const c2 = document.getElementById('canvas2');
    if (c1) c1.getContext('2d').clearRect(0, 0, c1.width, c1.height);
    if (c2) c2.getContext('2d').clearRect(0, 0, c2.width, c2.height);
}

/**
 * 3. メイン解析エンジン
 */
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
        resetBtn.addEventListener('click', () => {
            if (confirm("解析データをリセットしますか？")) clearAllAnalysis();
        });
    }

    toggleBtn.addEventListener('click', async () => {
        if (!isAnalyzed) {
            toggleBtn.disabled = true;
            document.getElementById('stats-overlay').classList.remove('d-none');
            
            if (v1.readyState < 2) await new Promise(r => v1.onloadeddata = r);
            poseData1 = await analyzeVideoInSteps(v1, pose, v2 ? "メイン動画" : "解析動画");

            if (v2) {
                await new Promise(r => setTimeout(r, 500));
                if (v2.readyState < 2) await new Promise(r => v2.onloadeddata = r);
                poseData2 = await analyzeVideoInSteps(v2, pose, "比較動画");
            }
            
            isAnalyzed = true;
            toggleBtn.disabled = false;
            if (resetBtn) resetBtn.classList.remove('d-none');
            document.getElementById('analysis-progress-container').classList.add('d-none');
            document.getElementById('stats-overlay').classList.add('d-none');
            toggleBtn.innerHTML = '<i class="fa-solid fa-play"></i> 解析表示 ON';
        }
        
        aiActive = !aiActive;
        toggleBtn.classList.toggle('btn-warning');
        toggleBtn.classList.toggle('btn-success');
        
        if (aiActive) renderLoop();
    });

    async function analyzeVideoInSteps(video, poseInstance, label) {
        const data = [];
        const duration = video.duration;
        const step = 0.1; 
        const originalTime = video.currentTime;
        const progressLabel = document.getElementById('progress-label');
        const progressBar = document.getElementById('analysis-progress-bar');
        const progressPercent = document.getElementById('progress-percent');

        video.pause();

        for (let t = 0; t <= duration; t += step) {
            const progress = Math.round((t / duration) * 100);
            if (progressLabel) progressLabel.innerText = `${label}: ${t.toFixed(1)}秒`;
            if (progressBar) progressBar.style.width = `${progress}%`;
            if (progressPercent) progressPercent.innerText = `${progress}%`;

            video.currentTime = t;
            await new Promise((resolve) => {
                let resolved = false;
                const onSeeked = () => { if (!resolved) { resolved = true; video.removeEventListener('seeked', onSeeked); resolve(); }};
                video.addEventListener('seeked', onSeeked);
                setTimeout(onSeeked, 1500);
            });

            currentResults = null;
            try {
                await poseInstance.send({image: video});
                let poll = 0;
                while (currentResults === null && poll < 40) {
                    await new Promise(r => setTimeout(r, 50));
                    poll++;
                }
                if (currentResults && currentResults.poseLandmarks) {
                    data.push({ time: t, landmarks: JSON.parse(JSON.stringify(currentResults.poseLandmarks)) });
                }
            } catch (e) { console.warn(`Analysis failed at ${t}s`); }
        }
        video.currentTime = originalTime;
        return data;
    }

    function renderLoop() {
        if (!aiActive) return;
        const l1 = getPoseAtTime(poseData1, v1.currentTime);
        drawOnCanvas(c1, ctx1, l1);
        if (v2 && ctx2) {
            const l2 = getPoseAtTime(poseData2, v2.currentTime);
            drawOnCanvas(c2, ctx2, l2);
        }
        animationId = requestAnimationFrame(renderLoop);
    }

    function drawOnCanvas(canvas, ctx, landmarks) {
        if (!ctx || !canvas) return;
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (landmarks) {
            drawConnectors(ctx, landmarks, POSE_CONNECTIONS, {color: '#00FF00', lineWidth: 2});
            drawLandmarks(ctx, landmarks, {color: '#FF0000', lineWidth: 1, radius: 2});
        }
    }
}

/**
 * 4. 動画同期ロジック (Master/Slave方式)
 */
function initVideoSync() {
    document.querySelectorAll('.comparison-container').forEach(container => {
        const v1 = container.querySelector('.video-1'); // 左（マスター）
        const v2 = container.querySelector('.video-2'); // 右（スレーブ）

        if (v1 && v2) {
            // 再生開始
            v1.addEventListener('play', () => {
                v2.play().catch(e => console.warn("Right video playback blocked by browser."));
            });
            // 一時停止
            v1.addEventListener('pause', () => {
                v2.pause();
            });
            // シーク（時間合わせ）
            v1.addEventListener('seeking', () => {
                v2.currentTime = v1.currentTime;
            });
            // 再生速度の同期
            v1.addEventListener('ratechange', () => {
                v2.playbackRate = v1.playbackRate;
            });
            // 読み込み待ちの同期
            v1.addEventListener('waiting', () => {
                v2.pause();
            });
            v1.addEventListener('playing', () => {
                v2.play().catch(e => {});
            });
        }
    });
}

/**
 * 5. その他の機能
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
        if (data.liked) {
            btnIcon.classList.replace('fa-regular', 'fa-solid');
            btnIcon.classList.add('text-danger');
        } else {
            btnIcon.classList.replace('fa-solid', 'fa-regular');
            btnIcon.classList.remove('text-danger');
        }
        if (countSpan) countSpan.innerText = data.count;
    }
}

window.addEventListener('pagehide', clearAllAnalysis);

document.addEventListener('DOMContentLoaded', () => {
    initVideoSync();
    initPoseDetection();
});
