import os
import sys
import shutil
import torch
import torch.nn as nn

SERVICE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SERVICE_ROOT not in sys.path:
    sys.path.insert(0, SERVICE_ROOT)

from inference.p2pnet_model import MobileNetV3P2PNet

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
    # 1. MobileNetV3-P2PNet Model (Point-to-Point Head Predictor)
    p2pnet_target = os.path.join(MODELS_DIR, "p2pnet-mobilenet.onnx")
    print(f"[models] Exporting MobileNetV3-P2PNet -> {p2pnet_target}...")
    p2p_model = MobileNetV3P2PNet(num_classes=2, k_points=1, img_size=640)
    p2p_model.eval()

    dummy_input = torch.zeros(1, 3, 640, 640, dtype=torch.float32)
    torch.onnx.export(
        p2p_model,
        dummy_input,
        p2pnet_target,
        export_params=True,
        opset_version=17,
        do_constant_folding=True,
        input_names=["input"],
        output_names=["pred_logits", "pred_points"],
        dynamic_axes={
            "input": {0: "batch_size"},
            "pred_logits": {0: "batch_size"},
            "pred_points": {0: "batch_size"},
        },
    )
    print(f"[models] Exported MobileNetV3-P2PNet -> {p2pnet_target}")

    # 2. Legacy YOLOv8 Head Model (Preserved for backwards compatibility)
    yolo_target = os.path.join(MODELS_DIR, "yolov8n-head.onnx")
    root_yolo_onnx = os.path.join(os.path.dirname(__file__), "..", "yolov8n.onnx")

    if os.path.exists(root_yolo_onnx) and not os.path.exists(yolo_target):
        shutil.copy(root_yolo_onnx, yolo_target)
        print(f"[models] Copied {root_yolo_onnx} -> {yolo_target}")

    print("[models] All models ready for DirectML execution!")


if __name__ == "__main__":
    prepare_models()
