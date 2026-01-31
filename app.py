import os
import uuid
import cv2
import json
import mediapipe as mp
from mediapipe.python.solutions import pose as mp_pose
from mediapipe.python.solutions import drawing_utils as mp_drawing
from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from PIL import Image
from models import db, User, Post, Like, Follow, Comment, create_tables
from forms import RegisterForm, LoginForm, PostForm, CommentForm

app = Flask(__name__)
app.config['SECRET_KEY'] = 'dev-secret-key'
app.config['UPLOAD_FOLDER'] = 'static/uploads/'

login_manager = LoginManager(app)
login_manager.login_view = 'login'

@login_manager.user_loader
def load_user(user_id):
    return User.get_or_none(User.id == int(user_id))

@app.context_processor
def inject_models():
    return dict(Like=Like, Post=Post)

# MediaPipe Pose 初期化
# --- 修正前 ---
# mp_pose = mp.solutions.pose

# --- 修正後 ---


@app.route('/')
@login_required
def index():
    posts = Post.select().order_by(Post.created_at.desc())
    return render_template('index.html', posts=posts)

# --- 認証系・投稿系ルート (以前と同じため省略可だが、構成維持のため保持) ---
@app.route('/login', methods=['GET', 'POST'])
def login():
    form = LoginForm()
    if form.validate_on_submit():
        user = User.get_or_none(User.username == form.username.data)
        if user and check_password_hash(user.password, form.password.data):
            login_user(user)
            return redirect(url_for('index'))
    return render_template('login.html', form=form)

@app.route('/post/<int:post_id>', methods=['GET', 'POST'])
@login_required
def post_detail(post_id):
    post = Post.get_or_none(Post.id == post_id)
    form = CommentForm()
    if form.validate_on_submit():
        Comment.create(user=current_user, post=post, content=form.content.data)
        return redirect(url_for('post_detail', post_id=post.id))
    comments = Comment.select().where(Comment.post == post).order_by(Comment.created_at.asc())
    return render_template('detail.html', post=post, form=form, comments=comments)

# --- 人間抽出 解析エンドポイント ---
@app.route('/analyze_human/<int:post_id>/<int:file_num>')
@login_required
def analyze_human(post_id, file_num):
    post = Post.get_by_id(post_id)
    file_name = post.file_path if file_num == 1 else post.file_path_2
    if not file_name: return jsonify([])

    video_path = os.path.join(app.config['UPLOAD_FOLDER'], file_name)
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    
    analysis_results = []
    
    # MediaPipe Pose セッション開始
    with mp_pose.Pose(static_image_mode=False, min_detection_confidence=0.5) as pose:
        frame_count = 0
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret: break
            
            frame_count += 1
            # 0.1秒ごとに解析
            if frame_count % max(1, int(fps / 10)) != 0: continue

            # RGBに変換して解析
            results = pose.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            
            rects = []
            if results.pose_landmarks:
                # 全関節の座標からバウンディングボックスを計算
                lm = results.pose_landmarks.landmark
                x_coords = [n.x for n in lm]
                y_coords = [n.y for n in lm]
                
                x_min, x_max = min(x_coords), max(x_coords)
                y_min, y_max = min(y_coords), max(y_coords)
                
                # 余白を持たせた矩形を作成
                rects.append({
                    "x": x_min, "y": y_min,
                    "w": x_max - x_min, "h": y_max - y_min,
                    "center_x": (x_min + x_max) / 2,
                    "center_y": (y_min + y_max) / 2
                })
            
            analysis_results.append({
                "time": round(frame_count / fps, 2),
                "rects": rects
            })

    cap.release()
    return jsonify(analysis_results)

if __name__ == '__main__':
    create_tables()
    app.run(port=8000, debug=True)
