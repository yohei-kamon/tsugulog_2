from flask_wtf import FlaskForm
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
