import os
import uuid
import numpy as np
from flask import Flask, render_template, request, redirect, url_for, flash, jsonify, send_from_directory
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from PIL import Image
from fastdtw import fastdtw
from scipy.spatial.distance import euclidean

from models import db, User, Post, Like, Comment, create_tables
from forms import RegisterForm, LoginForm, PostForm, CommentForm

app = Flask(__name__)
app.config['SECRET_KEY'] = 'industrial-skill-log'
app.config['UPLOAD_FOLDER'] = 'static/uploads/'

login_manager = LoginManager(app)
login_manager.login_view = 'login'

@login_manager.user_loader
def load_user(user_id):
    return User.get_or_none(User.id == int(user_id))

@app.context_processor
def inject_models():
    return dict(Like=Like, Post=Post)

@app.after_request
def add_header(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, X-CSRFToken'
    return response

# --- ヘルパー ---
def save_media(file, is_image=True):
    ext = os.path.splitext(file.filename)[1]
    filename = f"{uuid.uuid4()}{ext}"
    path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if is_image:
        img = Image.open(file)
        img.thumbnail((800, 800))
        img.save(path)
    else:
        file.save(path)
    return filename

# --- 認証ルート ---
@app.route('/register', methods=['GET', 'POST'])
def register():
    form = RegisterForm()
    if form.validate_on_submit():
        if User.get_or_none(User.username == form.username.data):
            flash('このユーザー名は既に使用されています。')
            return render_template('register.html', form=form)
        User.create(username=form.username.data, email=form.email.data, password=generate_password_hash(form.password.data))
        flash('登録完了しました。ログインしてください。')
        return redirect(url_for('login'))
    return render_template('register.html', form=form)

@app.route('/login', methods=['GET', 'POST'])
def login():
    form = LoginForm()
    if form.validate_on_submit():
        user = User.get_or_none(User.username == form.username.data)
        if user and check_password_hash(user.password, form.password.data):
            login_user(user)
            return redirect(url_for('index'))
        flash('ユーザー名またはパスワードが正しくありません。')
    return render_template('login.html', form=form)

@app.route('/logout')
def logout():
    logout_user(); return redirect(url_for('login'))

# --- メイン機能 ---
@app.route('/')
@login_required
def index():
    posts = Post.select().order_by(Post.created_at.desc())
    return render_template('index.html', posts=posts)

@app.route('/post/new', methods=['GET', 'POST'])
@login_required
def create_post():
    form = PostForm()
    if form.validate_on_submit():
        is_img = form.content_type.data == 'photo'
        f1 = save_media(request.files['file1'], is_image=is_img)
        f2 = save_media(request.files['file2'], is_image=is_img) if request.files.get('file2') else None
        Post.create(
            user=current_user, content_type=form.content_type.data, file_path=f1, file_path_2=f2,
            caption=form.caption.data, caption_2=form.caption_2.data,
            caption_3=form.caption_3.data, caption_4=form.caption_4.data,
            is_comparison=form.is_comparison.data
        )
        return redirect(url_for('index'))
    return render_template('post.html', form=form)

@app.route('/post/<int:post_id>', methods=['GET', 'POST'])
@login_required
def post_detail(post_id):
    post = Post.get_or_none(Post.id == post_id)
    if not post: return redirect(url_for('index'))
    form = CommentForm()
    if form.validate_on_submit():
        Comment.create(user=current_user, post=post, content=form.content.data)
        return redirect(url_for('post_detail', post_id=post.id))
    comments = Comment.select().where(Comment.post == post).order_by(Comment.created_at.asc())
    return render_template('detail.html', post=post, form=form, comments=comments)

# --- 技術採点エンジン (DTW) ---
@app.route('/analyze/dtw', methods=['POST'])
@login_required
def analyze_dtw():
    # 2つのデータセット(data1, data2)を受け取る
    json_data = request.json
    d1 = json_data.get('poseData1')
    d2 = json_data.get('poseData2') # 2画面モード用
    
    if not d1 or len(d1) < 5:
        return jsonify({'error': 'データ不足です'}), 400

    def extract_series(data_list, person_idx):
        series = []
        for frame in data_list:
            if len(frame['poses']) > person_idx:
                lm = frame['poses'][person_idx]
                joints = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
                vec = []
                for j in joints: vec.extend([lm[j]['x'], lm[j]['y']])
                series.append(vec)
        return np.array(series)

    # 1動画内比較か、2動画間比較かを判定
    if d2:
        s1 = extract_series(d1, 0)
        s2 = extract_series(d2, 0)
    else:
        s1 = extract_series(d1, 0)
        s2 = extract_series(d1, 1)

    if len(s1) == 0 or len(s2) == 0:
        return jsonify({'error': '比較対象が検出されませんでした'}), 400

    # DTW実行
    distance, path = fastdtw(s1, s2, dist=euclidean)

    cos_list, euc_list = [], []
    for (idx1, idx2) in path:
        v1, v2 = s1[idx1], s2[idx2]
        euc_list.append(euclidean(v1, v2))
        n1, n2 = np.linalg.norm(v1), np.linalg.norm(v2)
        if n1 > 0 and n2 > 0: cos_list.append(np.dot(v1, v2) / (n1 * n2))

    avg_cos = np.mean(cos_list) if cos_list else 0
    avg_euc = np.mean(euc_list) if euc_list else 1.0
    
    # 採点ロジック
    form_score = max(0, (avg_cos - 0.8) / (1.0 - 0.8)) * 100
    pos_score = max(0, 100 * (1 - (avg_euc / 0.2)))
    total_score = (form_score * 0.6) + (pos_score * 0.4)
    if avg_euc < 0.015 and avg_cos > 0.99: total_score = 100.0

    return jsonify({
        'dtw_score': round(total_score, 1),
        'avg_cosine': round(avg_cos, 4),
        'avg_euclidean': round(avg_euc, 4),
        'feedback': "動画間の動作軌跡を時間補正して採点しました。"
    })

@app.route('/like/<int:post_id>', methods=['POST'])
@login_required
def toggle_like(post_id):
    post = Post.get_by_id(post_id)
    like, created = Like.get_or_create(user=current_user, post=post)
    if not created: like.delete_instance()
    return jsonify({'liked': created, 'count': post.likes.count()})

if __name__ == '__main__':
    if not os.path.exists(app.config['UPLOAD_FOLDER']): os.makedirs(app.config['UPLOAD_FOLDER'])
    create_tables()
    app.run(port=8000, debug=True)
