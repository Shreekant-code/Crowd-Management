"use client";

/**
 * Robust WHEP (WebRTC HTTP Egress Protocol) Client
 * Connects HTML5 <video> to MediaMTX with complete ICE gathering,
 * progressive on-demand retry backoff, Strict-Mode lifecycle cleanup, and session teardown.
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
    this.retryTimeout = null;
  }

  async connect(videoElement, attempt = 1, maxAttempts = 4) {
    if (!this.url || !videoElement) {
      throw new Error("WHEP client requires a valid endpoint URL and video element.");
    }

    this.isClosed = false;
    this.onStateChange("connecting");

    console.log(`[WHEP-Debug] Initiating connection to: ${this.url} (Attempt ${attempt}/${maxAttempts})`);

    try {
      // 1. Create WebRTC Peer Connection with public STUN servers
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
        console.log(`[WHEP-Debug] RTCPeerConnection state: ${state}`);
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
        console.log("[WHEP-Debug] Received remote media track:", event.track.kind);
        if (event.streams && event.streams[0]) {
          videoElement.srcObject = event.streams[0];
          videoElement.play().catch(() => {
            videoElement.muted = true;
            videoElement.play().catch((e) => console.warn("[WHEP-Debug] Autoplay prevented:", e));
          });
        }
      };

      // 2. Request receive-only video transceiver
      pc.addTransceiver("video", { direction: "recvonly" });

      // 3. Create local SDP Offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE Gathering to complete before sending SDP Offer to MediaMTX
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
      console.log(`[WHEP-Debug] Sending SDP offer to MediaMTX: ${this.url}`);
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/sdp",
        },
        body: pc.localDescription?.sdp || offer.sdp,
      });

      console.log(`[WHEP-Debug] MediaMTX responded with status: ${response.status} ${response.statusText}`);

      // Handle 404 / 503 while MediaMTX on-demand source is warming up
      if ((response.status === 404 || response.status === 503) && attempt < maxAttempts && !this.isClosed) {
        console.warn(`[WHEP-Debug] Stream path is warming up in MediaMTX (${response.status}). Retrying in 1200ms...`);
        pc.close();
        this.pc = null;
        await new Promise((res) => {
          this.retryTimeout = setTimeout(res, 1200);
        });
        if (!this.isClosed) {
          return this.connect(videoElement, attempt + 1, maxAttempts);
        }
        return;
      }

      if (!response.ok) {
        if (this.isClosed) return;
        const errorText = await response.text().catch(() => "");
        if (response.status === 404) {
          console.log(`[WHEP-Debug] Path unavailable or camera stopped (${this.url}).`);
          this.onStateChange("idle");
          this.disconnect();
          return;
        }
        throw new Error(`MediaMTX WHEP request failed with status: ${response.status} ${response.statusText} - ${errorText}`);
      }

      // Store WHEP resource location header for session termination
      const locationHeader = response.headers.get("Location");
      if (locationHeader) {
        this.sessionUrl = new URL(locationHeader, this.url).toString();
        console.log(`[WHEP-Debug] WHEP session established at: ${this.sessionUrl}`);
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
      console.log("[WHEP-Debug] Remote SDP Answer applied successfully.");
    } catch (error) {
      if (this.isClosed) return;
      console.warn(`[WHEP-Debug] Connection ended: ${error.message}`);
      this.onError(error);
      this.onStateChange("failed");
      this.disconnect();
    }
  }

  disconnect() {
    this.isClosed = true;

    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }

    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }

    if (this.sessionUrl) {
      const deleteUrl = this.sessionUrl;
      this.sessionUrl = null;
      fetch(deleteUrl, { method: "DELETE", mode: "no-cors" }).catch(() => {});
    }

    if (this.pc) {
      try {
        this.pc.onconnectionstatechange = null;
        this.pc.ontrack = null;
        this.pc.onicegatheringstatechange = null;
        this.pc.close();
      } catch (_err) {
        // ignore closing errors
      }
      this.pc = null;
    }

    this.onStateChange("idle");
  }
}
