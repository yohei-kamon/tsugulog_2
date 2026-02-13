from flask_wtf import FlaskForm
from wtforms import StringField, PasswordField, TextAreaField, FileField, SelectField, BooleanField
from wtforms.validators import DataRequired, Email, Length


class RegisterForm(FlaskForm):
    username = StringField("Username", validators=[DataRequired(), Length(min=4, max=20)])
    email = StringField("Email", validators=[DataRequired(), Email()])
    password = PasswordField("Password", validators=[DataRequired(), Length(min=6)])


class LoginForm(FlaskForm):
    username = StringField("Username", validators=[DataRequired()])
    password = PasswordField("Password", validators=[DataRequired()])


class PostForm(FlaskForm):
    content_type = SelectField("Type", choices=[("photo", "Photo"), ("video", "Video")])
    file1 = FileField("File 1", validators=[DataRequired()])
    file2 = FileField("File 2 (Optional for Comparison)")
    is_comparison = BooleanField("Comparison Mode")
    caption = TextAreaField("キャプション", validators=[Length(max=500)])
    # caption_2 のラベルを「検討した選択肢」に変更
    caption_2 = TextAreaField("検討した選択肢", validators=[Length(max=500)])
    caption_3 = TextAreaField("最終判断とその理由")  # 追加
    caption_4 = TextAreaField("今回例外にした点")  # 追加


# forms.py に追記
class CommentForm(FlaskForm):
    content = TextAreaField("Comment", validators=[DataRequired(), Length(max=500)])
