package com.nethack3d.app;

import android.os.Bundle;
import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new Nh3dAndroidBridge(), "nh3dAndroid");
        }
    }

    private final class Nh3dAndroidBridge {

        @JavascriptInterface
        public void quitGame() {
            runOnUiThread(() -> {
                moveTaskToBack(true);
                finishAndRemoveTask();
            });
        }
    }
}
