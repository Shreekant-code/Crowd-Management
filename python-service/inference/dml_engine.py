from __future__ import annotations

import os
import sys
import threading
import time
from typing import Any, List, Optional, Tuple
import numpy as np
import onnxruntime as ort

# Global Re-entrant lock to prevent concurrent Direct3D 12 command queue collisions on AMD GPU
_DML_GLOBAL_LOCK = threading.RLock()


class DirectMLInferenceEngine:
    """
    High-Performance DirectML Inference Engine for AMD Radeon 610M (RDNA 2).
    
    1. Routes all tensor execution to DirectX 12 Compute Units via DmlExecutionProvider.
    2. Synchronizes command queue submissions to prevent DXGI_ERROR_DEVICE_REMOVED (887A0005).
    3. Seamlessly falls back to CPUExecutionProvider if a GPU TDR / device reset occurs.
    4. Supports dynamic batch sizes (Batch=1 to Batch=4) with zero reallocation.
    """

    def __init__(self, model_path: str, device_id: int = 0, warmup: bool = True) -> None:
        self.model_path = model_path
        self.device_id = device_id
        self.session: Optional[ort.InferenceSession] = None
        self.active_provider: str = "Uninitialized"
        self.input_name: str = ""
        self.input_shape: List[Any] = []
        self.output_names: List[str] = []
        self.is_fp16: bool = False

        self._initialize_session()

        if warmup:
            self._warmup_gpu()

    def _initialize_session(self) -> None:
        if not os.path.exists(self.model_path):
            raise FileNotFoundError(f"ONNX model not found at: {self.model_path}")

        providers = [
            ("DmlExecutionProvider", {"device_id": self.device_id}),
            "CPUExecutionProvider",
        ]

        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.enable_mem_pattern = True
        opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL

        with _DML_GLOBAL_LOCK:
            try:
                self.session = ort.InferenceSession(self.model_path, sess_options=opts, providers=providers)
                self.active_provider = self.session.get_providers()[0]
            except Exception as err:
                print(f"[dml-engine] DmlExecutionProvider init failed ({err}), falling back to CPU...")
                self._fallback_to_cpu()
                return

            inputs = self.session.get_inputs()
            self.input_name = inputs[0].name
            self.input_shape = inputs[0].shape
            self.output_names = [out.name for out in self.session.get_outputs()]

            input_type = inputs[0].type
            self.is_fp16 = "float16" in str(input_type).lower()

        print(
            f"[dml-engine] Initialized {os.path.basename(self.model_path)} "
            f"on [{self.active_provider}] (Precision: {'FP16' if self.is_fp16 else 'FP32'}, "
            f"Input: {self.input_name} {self.input_shape})"
        )

    def _fallback_to_cpu(self) -> None:
        """
        Transitions this inference engine to CPU Execution Provider on GPU suspension/reset.
        """
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.intra_op_num_threads = min(4, os.cpu_count() or 4)

        try:
            self.session = ort.InferenceSession(self.model_path, sess_options=opts, providers=["CPUExecutionProvider"])
            self.active_provider = "CPUExecutionProvider"
            inputs = self.session.get_inputs()
            self.input_name = inputs[0].name
            self.input_shape = inputs[0].shape
            self.output_names = [out.name for out in self.session.get_outputs()]
            self.is_fp16 = "float16" in str(inputs[0].type).lower()
            print(f"[dml-engine] Successfully transitioned {os.path.basename(self.model_path)} to CPUExecutionProvider.")
        except Exception as e:
            print(f"[dml-engine] Error initializing CPU fallback: {e}")

    def _warmup_gpu(self) -> None:
        try:
            dtype = np.float16 if self.is_fp16 else np.float32
            dummy_tensor = np.zeros((1, 3, 640, 640), dtype=dtype)
            with _DML_GLOBAL_LOCK:
                _ = self.session.run(self.output_names, {self.input_name: dummy_tensor})
            print(f"[dml-engine] Direct3D 12 shader warmup completed for {os.path.basename(self.model_path)}")
        except Exception as err:
            print(f"[dml-engine] GPU warmup warning for {os.path.basename(self.model_path)}: {err}")
            if "887A0005" in str(err) or "suspended" in str(err).lower():
                self._fallback_to_cpu()

    def infer_batch(self, batch_tensor: np.ndarray) -> np.ndarray:
        """
        Executes thread-safe batched inference on AMD Radeon / CPU fallback.
        batch_tensor: Shape (Batch, 3, 640, 640)
        """
        if self.session is None:
            self._initialize_session()

        target_dtype = np.float16 if self.is_fp16 else np.float32
        if batch_tensor.dtype != target_dtype:
            batch_tensor = batch_tensor.astype(target_dtype)

        with _DML_GLOBAL_LOCK:
            try:
                outputs = self.session.run(self.output_names, {self.input_name: batch_tensor})
                return outputs[0]
            except Exception as err:
                err_str = str(err)
                print(f"[dml-engine] Warning: Inference exception on {self.active_provider}: {err_str}")
                if "887A0005" in err_str or "suspended" in err_str.lower() or "device_removed" in err_str.lower():
                    print("[dml-engine] DirectML device suspended. Falling back to CPUExecutionProvider...")
                    self._fallback_to_cpu()
                    target_dtype = np.float16 if self.is_fp16 else np.float32
                    if batch_tensor.dtype != target_dtype:
                        batch_tensor = batch_tensor.astype(target_dtype)
                    outputs = self.session.run(self.output_names, {self.input_name: batch_tensor})
                    return outputs[0]
                raise err
