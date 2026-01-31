try:
    import mediapipe as mp
    if hasattr(mp, "solutions"):
        mp_pose = mp.solutions.pose
        mp_drawing = mp.solutions.drawing_utils
    else:
        from mediapipe.solutions import pose as mp_pose
        from mediapipe.solutions import drawing_utils as mp_drawing

    print("Success: mp_pose is available!")
    test_pose = mp_pose.Pose()
    print("Success: Pose instance created!")
except (AttributeError, ModuleNotFoundError) as e:
    print("Error:", e)
    print("対処: pip uninstall mediapipe のあと pip install mediapipe を実行してください。")
    import traceback
    traceback.print_exc()
except Exception as e:
    print("Error:", e)
    import traceback
    traceback.print_exc()
