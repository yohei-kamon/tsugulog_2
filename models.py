from peewee import *
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
    caption = TextField(null=True)   # これをキャプション1として使用
    caption_2 = TextField(null=True) # 追加：キャプション2
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
