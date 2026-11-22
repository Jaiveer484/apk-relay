# APK Relay

Send an Android build from one device to another over your local Wi-Fi.

1. Install Node.js 20 or newer.
2. Open this folder in VS Code and open **Terminal → New Terminal**.
3. Run `npm ci` and then `npm start`.
4. Find the computer's local IPv4 address in its network settings. If it is
   `192.168.1.20`, open `http://192.168.1.20:3000` on the sending device. Use
   the actual address so the QR code works on the receiving phone.
5. With both devices on the same Wi-Fi, upload an APK, scan the QR code with
   your Android phone, and tap **Download APK**. Allow Node.js on private
   networks if your firewall prompts you.

Transfers expire after 30 minutes. Files are stored temporarily on the
computer running Node.js. Anyone who has the link and can reach the server
can download the file while it is available. This version is intended for
trusted local networks and has no public hosting.
