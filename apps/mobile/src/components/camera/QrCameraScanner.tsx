/**
 * QR scanner modal for adding cameras (uses expo-camera + parseQrCodeData)
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { X, QrCode } from 'lucide-react-native';
import { parseQrCodeData } from '@/lib/camera/rtspHelper';
import { designSystem } from '@/theme/design-system';

export interface QrScanResult {
  rtspUrl?: string;
  ip?: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
}

interface QrCameraScannerProps {
  visible: boolean;
  onClose: () => void;
  onScan: (result: QrScanResult) => void;
}

export function QrCameraScanner({ visible, onClose, onScan }: QrCameraScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  const handleBarcode = useCallback(
    ({ data }: { data: string }) => {
      if (scanned) return;
      setScanned(true);
      const parsed = parseQrCodeData(data);
      if (!parsed || (!parsed.rtspUrl && !parsed.ip)) {
        Alert.alert('Unrecognized QR', 'Expected an RTSP URL or camera JSON QR code.', [
          {
            text: 'Try again',
            onPress: () => setScanned(false),
          },
          { text: 'Close', onPress: onClose },
        ]);
        return;
      }
      onScan(parsed);
      onClose();
      setScanned(false);
    },
    [scanned, onScan, onClose]
  );

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <QrCode size={20} color="#fff" />
            <Text style={styles.title}>Scan camera QR</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <X size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {!permission?.granted ? (
          <View style={styles.center}>
            <Text style={styles.hint}>Camera permission is required to scan QR codes.</Text>
            <TouchableOpacity style={styles.btn} onPress={requestPermission}>
              <Text style={styles.btnText}>Allow Camera</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scanned ? undefined : handleBarcode}
          >
            <View style={styles.overlay}>
              <View style={styles.frame} />
              <Text style={styles.hintOverlay}>
                Align the camera QR or RTSP barcode inside the frame
              </Text>
            </View>
          </CameraView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F14' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  camera: { flex: 1 },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  frame: {
    width: 240,
    height: 240,
    borderWidth: 2,
    borderColor: designSystem.colors.primary[500],
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  hintOverlay: {
    color: '#fff',
    marginTop: 20,
    textAlign: 'center',
    paddingHorizontal: 32,
    fontSize: 14,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  hint: { color: designSystem.colors.text.secondary, textAlign: 'center', marginBottom: 16 },
  btn: {
    backgroundColor: designSystem.colors.primary[500],
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  btnText: { color: '#fff', fontWeight: '600' },
});
