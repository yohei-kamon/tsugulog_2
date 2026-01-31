import os, uuid
from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from PIL import Image
from models import db, User, Post, Like, Follow, Comment, create_tables
from forms import RegisterForm, LoginForm, PostForm

app = Flask(__name__)
app.config["SECRET_KEY"] = "dev-secret-key"
app.config["UPLOAD_FOLDER"] = "static/uploads/"

login_manager = LoginManager(app)
login_manager.login_view = "login"


@login_manager.user_loader
def load_user(user_id):
    return User.get_or_none(User.id == int(user_id))


def save_media(file, is_image=True):
    ext = os.path.splitext(file.filename)[1]
    filename = f"{uuid.uuid4()}{ext}"
    path = os.path.join(app.config["UPLOAD_FOLDER"], filename)
    if is_image:
        img = Image.open(file)
        img.thumbnail((800, 800))
        img.save(path)
    else:
        file.save(path)
    return filename


@app.route("/")
@login_required
def index():
    posts = Post.select().order_by(Post.created_at.desc())
    return render_template("index.html", posts=posts)


@app.route("/register", methods=["GET", "POST"])
def register():
    form = RegisterForm()
    if form.validate_on_submit():
        User.create(
            username=form.username.data,
            email=form.email.data,
            password=generate_password_hash(form.password.data),
        )
        flash("Registered successfully!")
        return redirect(url_for("login"))
    return render_template("register.html", form=form)


@app.route("/login", methods=["GET", "POST"])
def login():
    form = LoginForm()
    if form.validate_on_submit():
        user = User.get_or_none(User.username == form.username.data)
        if user and check_password_hash(user.password, form.password.data):
            login_user(user)
            return redirect(url_for("index"))
        flash("Invalid credentials")
    return render_template("login.html", form=form)


@app.route("/logout")
def logout():
    logout_user()
    return redirect(url_for("login"))


@app.route("/post/new", methods=["GET", "POST"])
@login_required
def create_post():
    form = PostForm()
    if form.validate_on_submit():
        is_img = form.content_type.data == "photo"
        file1 = save_media(request.files["file1"], is_image=is_img)
        file2 = None
        if request.files.get("file2"):
            file2 = save_media(request.files["file2"], is_image=is_img)

        Post.create(
            user=current_user,
            content_type=form.content_type.data,
            file_path=file1,
            file_path_2=file2,
            caption=form.caption.data,
            is_comparison=form.is_comparison.data,
        )
        return redirect(url_for("index"))
    return render_template("post.html", form=form)


@app.route("/like/<int:post_id>", methods=["POST"])
@login_required
def toggle_like(post_id):
    post = Post.get_by_id(post_id)
    like, created = Like.get_or_create(user=current_user, post=post)
    if not created:
        like.delete_instance()
    return jsonify({"liked": created, "count": post.likes.count()})


if __name__ == "__main__":
    if not os.path.exists(app.config["UPLOAD_FOLDER"]):
        os.makedirs(app.config["UPLOAD_FOLDER"])
    create_tables()
    app.run(port=8000, debug=True)
