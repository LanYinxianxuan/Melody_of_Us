package com.melody.ai;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // WebView 安全加固：
        // 应用内容统一由 Capacitor 本地 https 服务加载，不需要 file:// / content:// 访问，
        // 全部关闭以缩小攻击面；同时禁止混合内容（https 页面加载 http 资源）。
        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    }
}
