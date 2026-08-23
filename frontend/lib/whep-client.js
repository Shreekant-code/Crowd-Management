"use client";

/**
 * Robust WHEP (WebRTC HTTP Egress Protocol) Client
 * Connects HTML5 <video> to MediaMTX with complete ICE gathering,
 * Strict-Mode lifecycle cleanup, and session teardown support.
 */
export class WhepClient {
  constructor({ url, onStateChange, onError }) {
    this.url = url;
    this.onStateChange = onStateChange || (() => {});
    this.onError = onError || (() => {});
    this.pc = null;
    this.sessionUrl = null;
    this.isClosed = false;
    this.connectionTimeout = null;
  }

  async connect(videoElement) {
    if (!this.url || !videoElement) {
      throw new Error("WHEP client requires a valid endpoint URL and video element.");
    }

    this.isClosed = false;
    this.onStateChange("connecting");

    try {
      // 1. Create WebRTC Peer Connection with public STUN server
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
        bundlePolicy: "max-bundle",
      });
      this.pc = pc;

      // Listen to peer connection state changes
      pc.onconnectionstatechange = () => {
        if (this.isClosed) return;
        const state = pc.connectionState;
        if (state === "connected") {
          this.onStateChange("live");
        } else if (state === "disconnected" || state === "failed") {
          this.onStateChange("reconnecting");
        } else if (state === "closed") {
          this.onStateChange("idle");
        }
      };

      // Attach incoming media stream to <video> element
      pc.ontrack = (event) => {
        if (this.isClosed || !videoElement) return;
        if (event.streams && event.streams[0]) {
          videoElement.srcObject = event.streams[0];
          videoElement.play().catch(() => {
            // Autoplay might require muted video
            videoElement.muted = true;
            videoElement.play().catch((e) => console.warn("[WHEP] Autoplay prevented:", e));
          });
        }
      };

      // 2. Request receive-only video transceiver
      pc.addTransceiver("video", { direction: "recvonly" });

      // 3. Create local SDP Offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Edge Case 1: Wait for ICE Gathering to complete before sending SDP Offer to MediaMTX
      await new Promise((resolve) => {
        if (pc.iceGatheringState === "complete") {
          resolve();
          return;
        }

        const checkIceState = () => {
          if (pc.iceGatheringState === "complete") {
            pc.removeEventListener("icegatheringstatechange", checkIceState);
            resolve();
          }
        };

        pc.addEventListener("icegatheringstatechange", checkIceState);

        // Fallback safety timeout (1200ms) in case some network interfaces do not trigger 'complete'
        setTimeout(() => {
          pc.removeEventListener("icegatheringstatechange", checkIceState);
          resolve();
        }, 1200);
      });

      if (this.isClosed) {
        pc.close();
        return;
      }

      // 4. POST SDP Offer to MediaMTX WHEP endpoint
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/sdp",
        },
        body: pc.localDescription?.sdp || offer.sdp,
      });

      if (!response.ok) {
        throw new Error(`MediaMTX WHEP request failed with status: ${response.status} ${response.statusText}`);
      }

      // Store WHEP resource location header for session termination
      const locationHeader = response.headers.get("Location");
      if (locationHeader) {
        this.sessionUrl = new URL(locationHeader, this.url).toString();
      }

      const answerSdp = await response.text();

      if (this.isClosed) {
        this.disconnect();
        return;
      }

      // 5. Apply remote SDP Answer from MediaMTX
      await pc.setRemoteDescription({
        type: "answer",
        sdp: answerSdp,
      });
    } catch (error) {
      if (this.isClosed) return;
      console.error("[WHEP] Connection failed:", error);
      this.onError(error);
      this.onStateChange("failed");
      this.disconnect();
    }
  }

  /**
   * Edge Case 3: Rigorous Strict-Mode and Component Teardown Cleanup
   */
  disconnect() {
    this.isClosed = true;

    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }

    // Send WHEP DELETE request to release server-side WebRTC session immediately
    if (this.sessionUrl) {
      const deleteUrl = this.sessionUrl;
      this.sessionUrl = null;
      try {
        fetch(deleteUrl, { method: "DELETE", mode: "no-cors" }).catch(() => {});
      } catch (_e) {
        // Ignore network errors on unload
      }
    }

    if (this.pc) {
      try {
        this.pc.onconnectionstatechange = null;
        this.pc.ontrack = null;
        this.pc.onicegatheringstatechange = null;
        this.pc.close();
      } catch (err) {
        console.warn("[WHEP] Error closing RTCPeerConnection:", err);
      }
      this.pc = null;
    }

    this.onStateChange("idle");
  }
}
