/**
 * 1. 動画の同期再生設定
 * 比較モードにおいて、左の動画(v1)の操作に合わせて右(v2)を制御します。
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
 * 2. Ajaxによるいいね機能
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
        countSpan.innerText = data.count;
    }
}

/**
 * 3. AI 姿勢解析 (高速間引き解析 & 線形補間方式)
 */
let aiActive = false;
let isAnalyzed = false;
let poseData1 = []; 
let poseData2 = [];
let currentResults = null; // AIの解析結果を受け取る一時的な変数

// 角度計算用ヘルパー
function calculateAngle(p1, p2, p3) {
    if (!p1 || !p2 || !p3) return 0;
    const radians = Math.atan2(p3.y - p2.y, p3.x - p2.x) - Math.atan2(p1.y - p2.y, p1.x - p2.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);
    if (angle > 180.0) angle = 360 - angle;
    return Math.round(angle);
}

// ポーズデータの線形補間 (Lerp)
function interpolatePose(p1, p2, ratio) {
    if (!p2) return p1.landmarks;
    return p1.landmarks.map((l1, i) => {
        const l2 = p2.landmarks[i];
        return {
            x: l1.x + (l2.x - l1.x) * ratio,
            y: l1.y + (l2.y - l1.y) * ratio,
            z: l1.z + (l2.z - l1.z) * ratio,
            visibility: l1.visibility + (l2.visibility - l1.visibility) * ratio
        };
    });
}

// 指定時刻のポーズデータを取得
function getPoseAtTime(data, time) {
    if (!data || data.length === 0) return null;
    let nextIdx = data.findIndex(d => d.time > time);
    
    if (nextIdx === 0) return data[0].landmarks;
    if (nextIdx === -1) return data[data.length - 1].landmarks;

    const prev = data[nextIdx - 1];
    const next = data[nextIdx];
    const ratio = (time - prev.time) / (next.time - prev.time);
    
    return interpolatePose(prev, next, ratio);
}

async function initPoseDetection() {
    const v1 = document.getElementById('video1');
    const v2 = document.getElementById('video2');
    const c1 = document.getElementById('canvas1');
    const c2 = document.getElementById('canvas2');
    const toggleBtn = document.getElementById('toggleAI');
    if (!v1 || !c1 || !toggleBtn) return;

    const ctx1 = c1.getContext('2d');
    const ctx2 = c2 ? c2.getContext('2d') : null;

    // MediaPipe Pose 初期化
    const pose = new Pose({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
    pose.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    
    // 解析結果を受け取るリスナーを登録
    pose.onResults((results) => {
        currentResults = results;
    });

    toggleBtn.addEventListener('click', async () => {
        if (!isAnalyzed) {
            toggleBtn.disabled = true;
            const stats = document.getElementById('stats-overlay');
            if (stats) stats.classList.remove('d-none');
            
            // ビデオがロードされているか確認
            if (v1.readyState < 2) {
                document.getElementById('progress-label').innerText = "Loading video data...";
                await new Promise(resolve => v1.onloadeddata = resolve);
            }

            // 高速解析 (0.4秒間隔)
            poseData1 = await analyzeVideoInSteps(v1, pose, "Primary Video");
            if (v2) {
                if (v2.readyState < 2) await new Promise(resolve => v2.onloadeddata = resolve);
                poseData2 = await analyzeVideoInSteps(v2, pose, "Comparison Video");
            }
            
            isAnalyzed = true;
            toggleBtn.disabled = false;
            document.getElementById('analysis-progress-container').classList.add('d-none');
            const statsData = document.getElementById('stats-data');
            if (statsData) statsData.classList.remove('d-none');
            toggleBtn.innerHTML = '<i class="fa-solid fa-play"></i> Show Pose Match';
        }
        
        aiActive = !aiActive;
        toggleBtn.classList.toggle('btn-warning');
        toggleBtn.classList.toggle('btn-success');
        
        if (aiActive) {
            renderLoop();
        } else {
            ctx1.clearRect(0, 0, c1.width, c1.height);
            if (ctx2) ctx2.clearRect(0, 0, c2.width, c2.height);
        }
    });

    /**
     * 動画をコマ送りしてAI解析を同期実行する
     */
    async function analyzeVideoInSteps(video, poseInstance, label) {
        const data = [];
        const duration = video.duration;
        const step = 0.4; 
        const originalTime = video.currentTime;

        const progressLabel = document.getElementById('progress-label');
        const progressBar = document.getElementById('analysis-progress-bar');
        const progressPercent = document.getElementById('progress-percent');

        for (let t = 0; t <= duration; t += step) {
            video.currentTime = t;
            
            // シーク完了を待つ (タイムアウト付き)
            await new Promise((resolve) => {
                const timer = setTimeout(resolve, 1500); // 最大1.5秒待機
                video.onseeked = () => { clearTimeout(timer); resolve(); };
            });

            // AI解析リクエストを送る前に結果変数をクリア
            currentResults = null;
            await poseInstance.send({image: video});

            // AIの結果が出るまでポーリングで待機
            let pollAttempts = 0;
            while (currentResults === null && pollAttempts < 100) {
                await new Promise(r => setTimeout(r, 30));
                pollAttempts++;
            }
            
            if (currentResults && currentResults.poseLandmarks) {
                data.push({ 
                    time: t, 
                    landmarks: JSON.parse(JSON.stringify(currentResults.poseLandmarks)) 
                });
            }

            const progress = Math.round((t / duration) * 100);
            if (progressLabel) progressLabel.innerText = `${label}: Scan ${t.toFixed(1)}s`;
            if (progressBar) progressBar.style.width = `${progress}%`;
            if (progressPercent) progressPercent.innerText = `${progress}%`;
        }
        
        video.currentTime = originalTime;
        return data;
    }

    /**
     * 描画ループ
     */
    function renderLoop() {
        if (!aiActive) return;

        const l1 = getPoseAtTime(poseData1, v1.currentTime);
        drawLandmarksOnCanvas(c1, ctx1, l1);
        
        if (v2 && c2) {
            const l2 = getPoseAtTime(poseData2, v2.currentTime);
            drawLandmarksOnCanvas(c2, ctx2, l2);
            if (l1 && l2) compareAndDrawStats(l1, l2, c2, ctx2);
        }
        
        requestAnimationFrame(renderLoop);
    }

    function drawLandmarksOnCanvas(canvas, ctx, landmarks) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (landmarks) {
            drawConnectors(ctx, landmarks, POSE_CONNECTIONS, {color: '#00FF00', lineWidth: 2});
            drawLandmarks(ctx, landmarks, {color: '#FF0000', lineWidth: 1, radius: 2});
        }
    }

    function compareAndDrawStats(l1, l2, canvas2, ctx2) {
        // 1. 角度差の計算
        const angleE1 = calculateAngle(l1[12], l1[14], l1[16]);
        const angleE2 = calculateAngle(l2[12], l2[14], l2[16]);
        document.getElementById('elbow-delta').innerText = Math.abs(angleE1 - angleE2);

        const angleK1 = calculateAngle(l1[24], l1[26], l1[28]);
        const angleK2 = calculateAngle(l2[24], l2[26], l2[28]);
        document.getElementById('knee-delta').innerText = Math.abs(angleK1 - angleK2);

        // 2. 差分線の描画 (右腰[24]を基準に平行移動)
        const offset = { x: l2[24].x - l1[24].x, y: l2[24].y - l1[24].y };
        ctx2.beginPath();
        ctx2.strokeStyle = '#FFEB3B';
        ctx2.lineWidth = 3;
        let diffSum = 0;

        const keypoints = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
        keypoints.forEach(i => {
            const x1 = (l1[i].x + offset.x) * canvas2.width;
            const y1 = (l1[i].y + offset.y) * canvas2.height;
            const x2 = l2[i].x * canvas2.width;
            const y2 = l2[i].y * canvas2.height;
            ctx2.moveTo(x1, y1);
            ctx2.lineTo(x2, y2);
            diffSum += Math.sqrt(Math.pow(l1[i].x + offset.x - l2[i].x, 2) + Math.pow(l1[i].y + offset.y - l2[i].y, 2));
        });
        ctx2.stroke();

        // 3. 類似度スコア
        const score = Math.max(0, 100 - Math.round(diffSum * 150));
        document.getElementById('pose-sync-score').innerText = score;
    }
}

// ページの初期化
document.addEventListener('DOMContentLoaded', () => {
    initVideoSync();
    initPoseDetection();
});
