import math
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.models as models


class MobileNetV3P2PNet(nn.Module):
    """
    MobileNetV3-P2PNet: Calibrated Point-to-Point Network for Edge Crowd Head Localization.
    
    1. Backbone: Pretrained MobileNetV3-Small with multi-scale FPN feature fusion.
    2. Multi-Scale Output: Stride 8 feature map (80x80 for 640x640 input).
    3. Classification Head: Outputs pred_logits (B, N, 2) [Background, Head].
    4. Regression Head: Outputs pred_points (B, N, 2) [x, y in pixel coordinates [0, 640]].
    5. Calibrated Focal Priors: Initialized for high-recall head point extraction.
    """

    def __init__(self, num_classes: int = 2, k_points: int = 1, img_size: int = 640):
        super().__init__()
        self.img_size = img_size
        self.k_points = k_points

        # Load MobileNetV3 Small backbone
        base = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.DEFAULT)
        features = base.features

        # MobileNetV3 Small feature stages:
        # features[0..3]: Stride 8 (24 channels)
        # features[4..8]: Stride 16 (48 channels)
        # features[9..12]: Stride 32 (576 channels)
        self.stage1 = nn.Sequential(*features[:4])   # Stride 8 (out: 24 channels)
        self.stage2 = nn.Sequential(*features[4:9])  # Stride 16 (out: 48 channels)
        self.stage3 = nn.Sequential(*features[9:])   # Stride 32 (out: 576 channels)

        # Lateral and FPN smooth layers
        self.lat3 = nn.Conv2d(576, 96, kernel_size=1)
        self.lat2 = nn.Conv2d(48, 96, kernel_size=1)
        self.lat1 = nn.Conv2d(24, 96, kernel_size=1)

        self.smooth = nn.Sequential(
            nn.Conv2d(96, 96, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(96),
            nn.ReLU(inplace=True),
        )

        # Classification Head (pred_logits)
        self.cls_head = nn.Sequential(
            nn.Conv2d(96, 64, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.Conv2d(64, 64, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.Conv2d(64, k_points * num_classes, kernel_size=1),
        )

        # Regression Head (point offset delta_x, delta_y)
        self.reg_head = nn.Sequential(
            nn.Conv2d(96, 64, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.Conv2d(64, 64, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.Conv2d(64, k_points * 2, kernel_size=1),
        )

        # Initialize classification head prior bias for stable confidence distribution
        prior_prob = 0.05
        bias_val = float(-math.log((1.0 - prior_prob) / prior_prob))
        nn.init.constant_(self.cls_head[-1].bias, 0.0)
        with torch.no_grad():
            self.cls_head[-1].bias[1] = bias_val

        # Precompute reference anchor grid at stride 8 (80x80)
        grid_h = img_size // 8
        grid_w = img_size // 8
        yv, xv = torch.meshgrid(
            torch.arange(grid_h, dtype=torch.float32),
            torch.arange(grid_w, dtype=torch.float32),
            indexing="ij",
        )
        # Center of each stride 8 cell
        grid_points = torch.stack([(xv + 0.5) * 8.0, (yv + 0.5) * 8.0], dim=-1)  # (80, 80, 2)
        grid_points = grid_points.view(1, -1, 2)  # (1, 6400, 2)
        self.register_buffer("anchor_grid", grid_points)

    def forward(self, x):
        # x: (B, 3, 640, 640)
        c1 = self.stage1(x)       # (B, 24, 80, 80)
        c2 = self.stage2(c1)      # (B, 48, 40, 40)
        c3 = self.stage3(c2)      # (B, 576, 20, 20)

        # FPN Top-down fusion
        p3 = self.lat3(c3)        # (B, 96, 20, 20)
        p2 = self.lat2(c2) + F.interpolate(p3, scale_factor=2, mode="nearest")  # (B, 96, 40, 40)
        p1 = self.lat1(c1) + F.interpolate(p2, scale_factor=2, mode="nearest")  # (B, 96, 80, 80)

        feat = self.smooth(p1)   # (B, 96, 80, 80)

        # Predict logits and point offsets
        cls_out = self.cls_head(feat)  # (B, 2, 80, 80)
        reg_out = self.reg_head(feat)  # (B, 2, 80, 80)

        B, _, H, W = cls_out.shape

        # Reshape logits -> (B, N, 2)
        pred_logits = cls_out.permute(0, 2, 3, 1).contiguous().view(B, -1, 2)

        # Reshape point offsets and add to anchor grid -> (B, N, 2)
        offsets = torch.tanh(reg_out.permute(0, 2, 3, 1).contiguous().view(B, -1, 2)) * 8.0
        pred_points = torch.clamp(self.anchor_grid + offsets, 0.0, float(self.img_size))

        return pred_logits, pred_points
