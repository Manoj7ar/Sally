// Screenshot service - captures screen via Electron desktopCapturer
import { desktopCapturer, screen } from 'electron';
import { mainLogger } from '../utils/logger.js';

class ScreenshotService {
  private resolveTargetDisplay(displayId?: number | null) {
    if (displayId !== undefined && displayId !== null) {
      const matchedDisplay = screen.getAllDisplays().find((display) => display.id === displayId);
      if (matchedDisplay) {
        return matchedDisplay;
      }
    }

    const cursorPoint = screen.getCursorScreenPoint();
    return screen.getDisplayNearestPoint(cursorPoint) || screen.getPrimaryDisplay();
  }

  async captureScreen(displayId?: number | null): Promise<string> {
    const targetDisplay = this.resolveTargetDisplay(displayId);
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: targetDisplay.bounds.width,
        height: targetDisplay.bounds.height,
      },
    });

    if (!sources || sources.length === 0) {
      throw new Error('No screen sources available for capture');
    }

    const displayIdString = String(targetDisplay.id);
    const selectedSource = sources.find((source) => source.display_id === displayIdString) || sources[0];
    const base64 = selectedSource.thumbnail.toPNG().toString('base64');
    mainLogger.info('[Screenshot] Captured display:', {
      requestedDisplayId: displayIdString,
      sourceDisplayId: selectedSource.display_id,
      sourceName: selectedSource.name,
      pngChars: base64.length,
    });
    return base64;
  }
}

export const screenshotService = new ScreenshotService();
