import os
import uuid
import numpy as np
from flask import Flask, render_template, request, redirect, url_for, flash, jsonify, send_from_directory
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from PIL import Image
from fastdtw import fastdtw
from scipy.spatial.distance import euclidean
from flask_wtf.csrf import CSRFProtect

from models import db, User, Post, Like, Comment, create_tables
from forms import RegisterForm, LoginForm, PostForm, CommentForm

app = Flask(__name__)
app.config['SECRET_KEY'] = 'industrial-sync-key'
app.config['UPLOAD_FOLDER'] = 'static/uploads/'

csrf = CSRFProtect(app)
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
    return response

# --- Helper ---
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

# --- Auth Routes ---
@app.route('/register', methods=['GET', 'POST'])
def register():
    form = RegisterForm()
    if form.validate_on_submit():
        User.create(username=form.username.data, email=form.email.data, password=generate_password_hash(form.password.data))
        flash('登録完了'); return redirect(url_for('login'))
    return render_template('register.html', form=form)

@app.route('/login', methods=['GET', 'POST'])
def login():
    form = LoginForm()
    if form.validate_on_submit():
        user = User.get_or_none(User.username == form.username.data)
        if user and check_password_hash(user.password, form.password.data):
            login_user(user); return redirect(url_for('index'))
    return render_template('login.html', form=form)

@app.route('/logout')
def logout():
    logout_user(); return redirect(url_for('login'))

# --- Main Routes ---
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
        Post.create(user=current_user, content_type=form.content_type.data, file_path=f1, file_path_2=f2, caption=form.caption.data, caption_2=form.caption_2.data, caption_3=form.caption_3.data, caption_4=form.caption_4.data, is_comparison=form.is_comparison.data)
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

@app.route('/post/<int:post_id>/delete', methods=['POST'])
@login_required
def delete_post(post_id):
    post = Post.get_or_none(Post.id == post_id)
    if post and post.user.id == current_user.id:
        for f in [post.file_path, post.file_path_2]:
            if f:
                p = os.path.join(app.config['UPLOAD_FOLDER'], f)
                if os.path.exists(p): os.remove(p)
        post.delete_instance(recursive=True)
    return redirect(url_for('index'))

# --- DTW Analysis ---
@app.route('/analyze/dtw', methods=['POST'])
@login_required
def analyze_dtw():
    data = request.json
    d1 = data.get('normPoseData1') or data.get('normPoseData') # 互換性維持
    d2 = data.get('normPoseData2')
    if not d1 or len(d1) < 5: return jsonify({'error': 'Insufficient data'}), 400

    def extract(dl, p_idx):
        s = []
        for f in dl:
            if len(f['poses']) > p_idx:
                lm = f['poses'][p_idx]
                v = []
                for j in [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]: v.extend([lm[j]['x'], lm[j]['y']])
                s.append(v)
        return np.array(s)

    s1 = extract(d1, 0)
    s2 = extract(d2, 0) if d2 else extract(d1, 1)

    if len(s1) == 0 or len(s2) == 0: return jsonify({'error': 'Person not detected'}), 400

    distance, path = fastdtw(s1, s2, dist=euclidean)
    eucs = [euclidean(s1[i], s2[j]) for i, j in path]
    avg_euc = np.mean(eucs)
    
    score = max(0, 100 * (1 - (avg_euc / 0.15))) # 採点感度調整
    if avg_euc < 0.01: score = 100

    return jsonify({'dtw_score': round(score, 1), 'avg_euclidean': round(avg_euc, 4)})

if __name__ == '__main__':
    if not os.path.exists(app.config['UPLOAD_FOLDER']): os.makedirs(app.config['UPLOAD_FOLDER'])
    create_tables()
    app.run(port=8000, debug=True)
