import os
import shutil
import torch
import torch.nn as nn
from ultralytics import YOLO

MODELS_DIR = os.path.join(os.path.dirname(__file__), "..", "models")
os.makedirs(MODELS_DIR, exist_ok=True)


class MobileCountBackbone(nn.Module):
    """
    Lightweight MobileNetV3-based Crowd Density Estimator.
    Designed for sub-10ms execution on AMD Radeon 610M DirectML.
    """
    def __init__(self):
        super().__init__()
        import torchvision.models as models
        base = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.DEFAULT)
        self.features = base.features  # Downsamples by 16x -> (N, 576, 40, 40)
        
        self.density_head = nn.Sequential(
            nn.Conv2d(576, 128, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(128),
            nn.ReLU(inplace=True),
            nn.Conv2d(128, 64, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.Conv2d(64, 1, kernel_size=1),
            nn.ReLU(inplace=True),
        )

    def forward(self, x):
        feat = self.features(x)
        density_map = self.density_head(feat)
        return density_map


def prepare_models():
    # 1. YOLOv8 Head Model
    yolo_target = os.path.join(MODELS_DIR, "yolov8n-head.onnx")
    root_yolo_onnx = os.path.join(os.path.dirname(__file__), "..", "yolov8n.onnx")

    if os.path.exists(root_yolo_onnx):
        shutil.copy(root_yolo_onnx, yolo_target)
        print(f"[models] Copied {root_yolo_onnx} -> {yolo_target}")
    else:
        print("[models] Exporting YOLOv8n to ONNX...")
        model = YOLO("yolov8n.pt")
        exported_path = model.export(format="onnx", imgsz=640, dynamic=True, simplify=True, opset=17)
        shutil.move(exported_path, yolo_target)
        print(f"[models] Exported YOLOv8n -> {yolo_target}")

    # 2. MobileCount Density Model
    mobilecount_target = os.path.join(MODELS_DIR, "mobilecount.onnx")
    print(f"[models] Exporting MobileCount -> {mobilecount_target}...")
    model = MobileCountBackbone()
    model.eval()

    dummy_input = torch.zeros(1, 3, 640, 640, dtype=torch.float32)
    torch.onnx.export(
        model,
        dummy_input,
        mobilecount_target,
        export_params=True,
        opset_version=17,
        do_constant_folding=True,
        input_names=["input"],
        output_names=["density_map"],
        dynamic_axes={
            "input": {0: "batch_size"},
            "density_map": {0: "batch_size"},
        },
    )
    print(f"[models] Exported MobileCount -> {mobilecount_target}")
    print("[models] All models ready for DirectML execution!")


if __name__ == "__main__":
    prepare_models()
