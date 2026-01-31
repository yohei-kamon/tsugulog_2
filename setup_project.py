import os

# プロジェクトの基本構造
files = {
    "models.py": """from peewee import *
from flask_login import UserMixin
import datetime

db = SqliteDatabase('tsugulog.db')

class User(UserMixin, Model):
    username = CharField(unique=True)
    email = CharField(unique=True)
    password = CharField()
    profile_image = CharField(default='default_profile.png')
    bio = TextField(null=True)
    created_at = DateTimeField(default=datetime.datetime.now)

    class Meta:
        database = db

class Post(Model):
    user = ForeignKeyField(User, backref='posts')
    content_type = CharField() # 'photo' or 'video'
    file_path = CharField()
    file_path_2 = CharField(null=True)
    caption = TextField(null=True)
    is_comparison = BooleanField(default=False)
    created_at = DateTimeField(default=datetime.datetime.now)

    class Meta:
        database = db

class Like(Model):
    user = ForeignKeyField(User, backref='likes')
    post = ForeignKeyField(Post, backref='likes')
    class Meta:
        database = db
        indexes = ((('user', 'post'), True),)

class Follow(Model):
    from_user = ForeignKeyField(User, backref='following')
    to_user = ForeignKeyField(User, backref='followers')
    class Meta:
        database = db

class Comment(Model):
    user = ForeignKeyField(User, backref='comments')
    post = ForeignKeyField(Post, backref='comments')
    content = TextField()
    created_at = DateTimeField(default=datetime.datetime.now)
    class Meta:
        database = db

def create_tables():
    with db:
        db.create_tables([User, Post, Like, Follow, Comment])
""",
    "forms.py": """from flask_wtf import FlaskForm
from wtforms import StringField, PasswordField, TextAreaField, FileField, SelectField, BooleanField
from wtforms.validators import DataRequired, Email, Length

class RegisterForm(FlaskForm):
    username = StringField('Username', validators=[DataRequired(), Length(min=4, max=20)])
    email = StringField('Email', validators=[DataRequired(), Email()])
    password = PasswordField('Password', validators=[DataRequired(), Length(min=6)])

class LoginForm(FlaskForm):
    username = StringField('Username', validators=[DataRequired()])
    password = PasswordField('Password', validators=[DataRequired()])

class PostForm(FlaskForm):
    content_type = SelectField('Type', choices=[('photo', 'Photo'), ('video', 'Video')])
    file1 = FileField('File 1', validators=[DataRequired()])
    file2 = FileField('File 2 (Optional for Comparison)')
    is_comparison = BooleanField('Comparison Mode')
    caption = TextAreaField('Caption', validators=[Length(max=500)])
""",
    "app.py": """import os, uuid
from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from PIL import Image
from models import db, User, Post, Like, Follow, Comment, create_tables
from forms import RegisterForm, LoginForm, PostForm

app = Flask(__name__)
app.config['SECRET_KEY'] = 'dev-secret-key'
app.config['UPLOAD_FOLDER'] = 'static/uploads/'

login_manager = LoginManager(app)
login_manager.login_view = 'login'

@login_manager.user_loader
def load_user(user_id):
    return User.get_or_none(User.id == int(user_id))

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

@app.route('/')
@login_required
def index():
    posts = Post.select().order_by(Post.created_at.desc())
    return render_template('index.html', posts=posts)

@app.route('/register', methods=['GET', 'POST'])
def register():
    form = RegisterForm()
    if form.validate_on_submit():
        User.create(
            username=form.username.data,
            email=form.email.data,
            password=generate_password_hash(form.password.data)
        )
        flash('Registered successfully!')
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
        flash('Invalid credentials')
    return render_template('login.html', form=form)

@app.route('/logout')
def logout():
    logout_user()
    return redirect(url_for('login'))

@app.route('/post/new', methods=['GET', 'POST'])
@login_required
def create_post():
    form = PostForm()
    if form.validate_on_submit():
        is_img = form.content_type.data == 'photo'
        file1 = save_media(request.files['file1'], is_image=is_img)
        file2 = None
        if request.files.get('file2'):
            file2 = save_media(request.files['file2'], is_image=is_img)
        
        Post.create(
            user=current_user,
            content_type=form.content_type.data,
            file_path=file1,
            file_path_2=file2,
            caption=form.caption.data,
            is_comparison=form.is_comparison.data
        )
        return redirect(url_for('index'))
    return render_template('post.html', form=form)

@app.route('/like/<int:post_id>', methods=['POST'])
@login_required
def toggle_like(post_id):
    post = Post.get_by_id(post_id)
    like, created = Like.get_or_create(user=current_user, post=post)
    if not created:
        like.delete_instance()
    return jsonify({'liked': created, 'count': post.likes.count()})

if __name__ == '__main__':
    if not os.path.exists(app.config['UPLOAD_FOLDER']):
        os.makedirs(app.config['UPLOAD_FOLDER'])
    create_tables()
    app.run(port=8000, debug=True)
""",
    "templates/base.html": """<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TsuguLog</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-light">
    <nav class="navbar navbar-expand-lg navbar-light bg-white border-bottom sticky-top">
        <div class="container">
            <a class="navbar-brand fw-bold" href="/">TsuguLog</a>
            {% if current_user.is_authenticated %}
            <div class="d-flex align-items-center">
                <a href="{{ url_for('create_post') }}" class="btn btn-outline-dark btn-sm me-3"><i class="fa-regular fa-square-plus"></i></a>
                <a href="{{ url_for('logout') }}" class="btn btn-sm btn-link text-dark">Logout</a>
            </div>
            {% endif %}
        </div>
    </nav>
    <div class="container py-4">
        {% with messages = get_flashed_messages() %}
          {% if messages %}
            {% for message in messages %}
              <div class="alert alert-info">{{ message }}</div>
            {% endfor %}
          {% endif %}
        {% endwith %}
        {% block content %}{% endblock %}
    </div>
    <script src="/static/js/main.js"></script>
</body>
</html>
""",
    "templates/index.html": """{% extends "base.html" %}
{% block content %}
<div class="row justify-content-center">
    <div class="col-md-8 col-lg-6">
        {% for post in posts %}
        <div class="card mb-4 border-0 shadow-sm">
            <div class="card-header bg-white py-3 border-0">
                <strong>@{{ post.user.username }}</strong>
            </div>
            <div class="post-media bg-black text-center">
                {% if post.is_comparison %}
                <div class="comparison-container d-flex overflow-hidden">
                    <video src="/static/uploads/{{ post.file_path }}" class="video-1 w-50 border-end border-secondary" controls></video>
                    <video src="/static/uploads/{{ post.file_path_2 }}" class="video-2 w-50" muted></video>
                </div>
                {% elif post.content_type == 'photo' %}
                <img src="/static/uploads/{{ post.file_path }}" class="img-fluid">
                {% else %}
                <video src="/static/uploads/{{ post.file_path }}" class="w-100" controls></video>
                {% endif %}
            </div>
            <div class="card-body">
                <div class="mb-2">
                    <button class="btn p-0 me-3" onclick="toggleLike({{ post.id }})" id="like-btn-{{ post.id }}">
                        <i class="fa-heart fa-lg {% if current_user.likes.select().where(Like.post == post).exists() %}fa-solid text-danger{% else %}fa-regular{% endif %}"></i>
                    </button>
                    <span id="like-count-{{ post.id }}" class="fw-bold">{{ post.likes.count() }}</span> likes
                </div>
                <p><strong>{{ post.user.username }}</strong> {{ post.caption }}</p>
            </div>
        </div>
        {% endfor %}
    </div>
</div>
<input type="hidden" id="csrf_token" value="{{ csrf_token() if csrf_token else '' }}">
{% endblock %}
""",
    "templates/post.html": """{% extends "base.html" %}
{% block content %}
<div class="card mx-auto shadow-sm" style="max-width: 500px;">
    <div class="card-body">
        <h5 class="card-title mb-4">Create New Post</h5>
        <form method="POST" enctype="multipart/form-data">
            {{ form.hidden_tag() }}
            <div class="mb-3">
                {{ form.content_type.label(class="form-label") }}
                {{ form.content_type(class="form-select") }}
            </div>
            <div class="mb-3">
                {{ form.file1.label(class="form-label") }}
                {{ form.file1(class="form-control") }}
            </div>
            <div class="mb-3">
                <label class="form-check-label">{{ form.is_comparison() }} Comparison Mode (Upload 2nd file)</label>
            </div>
            <div class="mb-3">
                {{ form.file2.label(class="form-label") }}
                {{ form.file2(class="form-control") }}
            </div>
            <div class="mb-3">
                {{ form.caption.label(class="form-label") }}
                {{ form.caption(class="form-control", rows=3) }}
            </div>
            <button type="submit" class="btn btn-primary w-100">Post</button>
        </form>
    </div>
</div>
{% endblock %}
""",
    "templates/login.html": """{% extends "base.html" %}
{% block content %}
<div class="card mx-auto shadow-sm" style="max-width: 400px;">
    <div class="card-body">
        <h5 class="card-title text-center mb-4">Login to TsuguLog</h5>
        <form method="POST">
            {{ form.hidden_tag() }}
            <div class="mb-3">{{ form.username(class="form-control", placeholder="Username") }}</div>
            <div class="mb-3">{{ form.password(class="form-control", placeholder="Password") }}</div>
            <button type="submit" class="btn btn-dark w-100">Login</button>
        </form>
        <div class="text-center mt-3 small">
            Don't have an account? <a href="{{ url_for('register') }}">Sign up</a>
        </div>
    </div>
</div>
{% endblock %}
""",
    "templates/register.html": """{% extends "base.html" %}
{% block content %}
<div class="card mx-auto shadow-sm" style="max-width: 400px;">
    <div class="card-body">
        <h5 class="card-title text-center mb-4">Join TsuguLog</h5>
        <form method="POST">
            {{ form.hidden_tag() }}
            <div class="mb-3">{{ form.username(class="form-control", placeholder="Username") }}</div>
            <div class="mb-3">{{ form.email(class="form-control", placeholder="Email") }}</div>
            <div class="mb-3">{{ form.password(class="form-control", placeholder="Password") }}</div>
            <button type="submit" class="btn btn-primary w-100">Sign Up</button>
        </form>
        <div class="text-center mt-3 small">
            Already have an account? <a href="{{ url_for('login') }}">Login</a>
        </div>
    </div>
</div>
{% endblock %}
""",
    "static/js/main.js": """// 動画の同期再生
document.querySelectorAll('.comparison-container').forEach(container => {
    const v1 = container.querySelector('.video-1');
    const v2 = container.querySelector('.video-2');

    if (v1 && v2) {
        v1.addEventListener('play', () => v2.play());
        v1.addEventListener('pause', () => v2.pause());
        v1.addEventListener('seeking', () => { v2.currentTime = v1.currentTime; });
    }
});

// Ajaxによるいいね機能
async function toggleLike(postId) {
    const response = await fetch(`/like/${postId}`, {
        method: 'POST',
        headers: { 'X-CSRFToken': document.querySelector('#csrf_token')?.value || '' }
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
""",
    ".gitignore": """tsugulog.db
venv/
__pycache__/
static/uploads/*
!static/uploads/.gitkeep
""",
}


# ディレクトリとファイルの作成実行
def setup():
    for path, content in files.items():
        dir_name = os.path.dirname(path)
        if dir_name and not os.path.exists(dir_name):
            os.makedirs(dir_name)

        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
            print(f"Created: {path}")

    # uploadsフォルダに.gitkeepを作成
    os.makedirs("static/uploads", exist_ok=True)
    with open("static/uploads/.gitkeep", "w") as f:
        pass


if __name__ == "__main__":
    setup()
    print("\\nSetup complete! Run following commands:")
    print("pip install flask flask-login flask-wtf peewee Pillow email-validator")
    print("python app.py")
