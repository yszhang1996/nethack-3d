package com.nethack3d.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.webkit.JavascriptInterface;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.plugin.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.TimeZone;

public class MainActivity extends BridgeActivity {

    private static final String UPDATE_ROOT_DIR_NAME = "nh3d-game-updates";
    private static final String UPDATE_CURRENT_DIR_NAME = "current";
    private static final String UPDATE_STAGING_DIR_NAME = "staging";
    private static final String ACTIVE_UPDATE_FILE_NAME = "active-update.json";
    private static final String UPDATE_FALLBACK_NOTICE_FILE_NAME = "fallback-notice.json";
    private static final String UPDATE_FALLBACK_USER_MESSAGE =
        "Game update data was corrupted and had to be cleared out. If this keeps happening, download the latest proper client update and try again.";
    private static final int NETWORK_CONNECT_TIMEOUT_MS = 30000;
    private static final int NETWORK_READ_TIMEOUT_MS = 30000;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        sanitizeActiveUpdateStateOnStartup();
        super.onCreate(savedInstanceState);

        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new Nh3dAndroidBridge(), "nh3dAndroid");
        }
    }

    private File getUpdateRootDir() {
        return new File(getFilesDir(), UPDATE_ROOT_DIR_NAME);
    }

    private File getUpdateCurrentDir() {
        return new File(getUpdateRootDir(), UPDATE_CURRENT_DIR_NAME);
    }

    private File getUpdateStagingDir() {
        return new File(getUpdateRootDir(), UPDATE_STAGING_DIR_NAME);
    }

    private File getActiveUpdateMetadataFile() {
        return new File(getUpdateRootDir(), ACTIVE_UPDATE_FILE_NAME);
    }

    private File getUpdateFallbackNoticeFile() {
        return new File(getUpdateRootDir(), UPDATE_FALLBACK_NOTICE_FILE_NAME);
    }

    private static String normalizeNullableString(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value.trim();
        return normalized.isEmpty() ? null : normalized;
    }

    private static String normalizeSafeRelativePath(String value) {
        String normalized = normalizeNullableString(value);
        if (normalized == null) {
            return null;
        }
        normalized = normalized.replace("\\", "/");
        if (normalized.startsWith("/") || normalized.contains("..")) {
            return null;
        }
        return normalized;
    }

    private static String trimTrailingSlash(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        int end = value.length();
        while (end > 0 && value.charAt(end - 1) == '/') {
            end -= 1;
        }
        return value.substring(0, end);
    }

    private static String getCurrentTimestampIsoUtc() {
        java.text.SimpleDateFormat formatter =
            new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        return formatter.format(new java.util.Date());
    }

    private static String sha256ToHex(byte[] digestBytes) {
        StringBuilder builder = new StringBuilder(digestBytes.length * 2);
        for (byte digestByte : digestBytes) {
            int value = digestByte & 0xFF;
            if (value < 16) {
                builder.append('0');
            }
            builder.append(Integer.toHexString(value));
        }
        return builder.toString();
    }

    private static String computeFileSha256Hex(File file)
        throws IOException, NoSuchAlgorithmException {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (
            InputStream input = new BufferedInputStream(new FileInputStream(file));
            DigestInputStream digestInput = new DigestInputStream(input, digest)
        ) {
            byte[] buffer = new byte[8192];
            while (digestInput.read(buffer) >= 0) {
                // Reading through DigestInputStream updates the digest.
            }
        }
        return sha256ToHex(digest.digest());
    }

    private static byte[] readAllBytes(InputStream inputStream) throws IOException {
        byte[] buffer = new byte[8192];
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        int readCount;
        while ((readCount = inputStream.read(buffer)) >= 0) {
            output.write(buffer, 0, readCount);
        }
        return output.toByteArray();
    }

    private static void writeTextFile(File file, String payload) throws IOException {
        File parent = file.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("Unable to create directory: " + parent.getAbsolutePath());
        }
        try (OutputStream output = new FileOutputStream(file)) {
            output.write(payload.getBytes(StandardCharsets.UTF_8));
        }
    }

    private static String readTextFile(File file) throws IOException {
        try (InputStream input = new FileInputStream(file)) {
            return new String(readAllBytes(input), StandardCharsets.UTF_8);
        }
    }

    private static boolean deleteRecursively(File target) {
        if (target == null || !target.exists()) {
            return true;
        }
        if (target.isDirectory()) {
            File[] children = target.listFiles();
            if (children != null) {
                for (File child : children) {
                    if (!deleteRecursively(child)) {
                        return false;
                    }
                }
            }
        }
        return target.delete();
    }

    private static void copyRecursively(File source, File destination) throws IOException {
        if (source.isDirectory()) {
            if (!destination.exists() && !destination.mkdirs()) {
                throw new IOException("Unable to create directory: " + destination.getAbsolutePath());
            }
            File[] children = source.listFiles();
            if (children == null) {
                return;
            }
            for (File child : children) {
                copyRecursively(child, new File(destination, child.getName()));
            }
            return;
        }

        File parent = destination.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("Unable to create directory: " + parent.getAbsolutePath());
        }
        try (
            InputStream input = new BufferedInputStream(new FileInputStream(source));
            OutputStream output = new BufferedOutputStream(new FileOutputStream(destination))
        ) {
            byte[] buffer = new byte[8192];
            int readCount;
            while ((readCount = input.read(buffer)) >= 0) {
                output.write(buffer, 0, readCount);
            }
        }
    }

    private static HttpURLConnection openHttpConnection(String urlValue) throws IOException {
        URL url = new URL(urlValue);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(NETWORK_CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(NETWORK_READ_TIMEOUT_MS);
        connection.setUseCaches(false);
        connection.setRequestProperty("Cache-Control", "no-cache");
        connection.setRequestProperty("Pragma", "no-cache");
        return connection;
    }

    private static JSONObject fetchJsonFromUrl(String urlValue) throws IOException, JSONException {
        HttpURLConnection connection = openHttpConnection(urlValue);
        try {
            int statusCode = connection.getResponseCode();
            if (statusCode < 200 || statusCode >= 300) {
                throw new IOException(
                    "HTTP " + statusCode + " when requesting update manifest."
                );
            }
            try (InputStream input = new BufferedInputStream(connection.getInputStream())) {
                return new JSONObject(new String(readAllBytes(input), StandardCharsets.UTF_8));
            }
        } finally {
            connection.disconnect();
        }
    }

    private static void downloadFileWithValidation(
        String sourceUrl,
        File destination,
        long expectedSize,
        String expectedSha256
    ) throws IOException, NoSuchAlgorithmException {
        HttpURLConnection connection = openHttpConnection(sourceUrl);
        try {
            int statusCode = connection.getResponseCode();
            if (statusCode < 200 || statusCode >= 300) {
                throw new IOException(
                    "HTTP " + statusCode + " when downloading update file."
                );
            }

            File parent = destination.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) {
                throw new IOException("Unable to create directory: " + parent.getAbsolutePath());
            }

            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long writtenBytes = 0;
            try (
                InputStream input = new BufferedInputStream(connection.getInputStream());
                DigestInputStream digestInput = new DigestInputStream(input, digest);
                OutputStream output = new BufferedOutputStream(new FileOutputStream(destination))
            ) {
                byte[] buffer = new byte[8192];
                int readCount;
                while ((readCount = digestInput.read(buffer)) >= 0) {
                    output.write(buffer, 0, readCount);
                    writtenBytes += readCount;
                }
            }

            if (expectedSize >= 0 && writtenBytes != expectedSize) {
                throw new IOException(
                    "Expected " + expectedSize + " bytes but received " + writtenBytes + "."
                );
            }
            if (expectedSha256 != null && !expectedSha256.isEmpty()) {
                String actualSha = sha256ToHex(digest.digest());
                if (!actualSha.equalsIgnoreCase(expectedSha256)) {
                    throw new IOException(
                        "SHA256 mismatch. Expected " + expectedSha256 + ", got " + actualSha + "."
                    );
                }
            }
        } finally {
            connection.disconnect();
        }
    }

    private static boolean tryReuseLocalFileWithMatchingHash(
        File source,
        File destination,
        String expectedSha256
    ) throws IOException, NoSuchAlgorithmException {
        String normalizedExpectedSha = normalizeNullableString(expectedSha256);
        if (normalizedExpectedSha == null) {
            return false;
        }
        if (source == null || !source.exists() || !source.isFile()) {
            return false;
        }
        String actualSha = computeFileSha256Hex(source);
        if (!actualSha.equalsIgnoreCase(normalizedExpectedSha)) {
            return false;
        }
        copyRecursively(source, destination);
        return true;
    }

    private JSONObject readActiveUpdateInfo() {
        File metadataFile = getActiveUpdateMetadataFile();
        if (!metadataFile.exists()) {
            return null;
        }
        try {
            JSONObject raw = new JSONObject(readTextFile(metadataFile));
            String buildId = normalizeNullableString(raw.optString("buildId", null));
            String buildRootPath = normalizeNullableString(raw.optString("buildRootPath", null));
            if (buildId == null || buildRootPath == null) {
                clearCorruptUpdateDataForFallback("Active update metadata is invalid.");
                return null;
            }
            File indexFile = new File(buildRootPath, "index.html");
            if (!indexFile.exists()) {
                clearCorruptUpdateDataForFallback(
                    "Active update index.html is missing from the update bundle."
                );
                return null;
            }
            JSONObject normalized = new JSONObject();
            normalized.put("buildId", buildId);
            normalized.put("buildRootPath", buildRootPath);
            normalized.put("commitSha", normalizeNullableString(raw.optString("commitSha", null)));
            normalized.put("updatedAt", normalizeNullableString(raw.optString("updatedAt", null)));
            normalized.put("manifestUrl", normalizeNullableString(raw.optString("manifestUrl", null)));
            normalized.put("clientVersion", normalizeNullableString(raw.optString("clientVersion", null)));
            return normalized;
        } catch (Exception exception) {
            String message = exception.getMessage();
            clearCorruptUpdateDataForFallback(
                message != null && !message.trim().isEmpty()
                    ? "Unable to read active update metadata: " + message
                    : "Unable to read active update metadata."
            );
            return null;
        }
    }

    private void persistServerBasePath(String serverBasePath) {
        SharedPreferences preferences =
            getSharedPreferences(WebView.WEBVIEW_PREFS_NAME, Context.MODE_PRIVATE);
        preferences
            .edit()
            .putString(WebView.CAP_SERVER_PATH, serverBasePath)
            .apply();
    }

    private void clearPersistedServerBasePath() {
        SharedPreferences preferences =
            getSharedPreferences(WebView.WEBVIEW_PREFS_NAME, Context.MODE_PRIVATE);
        preferences
            .edit()
            .remove(WebView.CAP_SERVER_PATH)
            .apply();
    }

    private void applyServerBasePath(String serverBasePath) {
        runOnUiThread(() -> {
            if (getBridge() != null) {
                getBridge().setServerBasePath(serverBasePath);
            }
        });
    }

    private void persistUpdateFallbackNotice(String reason) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("at", getCurrentTimestampIsoUtc());
            payload.put("message", UPDATE_FALLBACK_USER_MESSAGE);
            payload.put("reason", normalizeNullableString(reason));
            writeTextFile(getUpdateFallbackNoticeFile(), payload.toString(2));
        } catch (Exception ignored) {
            // Ignore fallback notice persistence failures.
        }
    }

    private String readAndClearUpdateFallbackNotice() {
        File noticeFile = getUpdateFallbackNoticeFile();
        if (!noticeFile.exists()) {
            return null;
        }
        String message = null;
        try {
            JSONObject payload = new JSONObject(readTextFile(noticeFile));
            message = normalizeNullableString(payload.optString("message", null));
        } catch (Exception ignored) {
            message = null;
        }
        if (message == null) {
            message = UPDATE_FALLBACK_USER_MESSAGE;
        }
        //noinspection ResultOfMethodCallIgnored
        noticeFile.delete();
        return message;
    }

    private void clearCorruptUpdateDataForFallback(String reason) {
        String normalizedReason = normalizeNullableString(reason);
        if (normalizedReason == null) {
            normalizedReason = "Corrupt active update metadata.";
        }
        //noinspection ResultOfMethodCallIgnored
        deleteRecursively(getUpdateCurrentDir());
        //noinspection ResultOfMethodCallIgnored
        deleteRecursively(getUpdateStagingDir());
        //noinspection ResultOfMethodCallIgnored
        getActiveUpdateMetadataFile().delete();
        clearPersistedServerBasePath();
        persistUpdateFallbackNotice(normalizedReason);
    }

    private void sanitizeActiveUpdateStateOnStartup() {
        // Triggers corruption cleanup + notice for invalid metadata/index states.
        readActiveUpdateInfo();

        SharedPreferences preferences =
            getSharedPreferences(WebView.WEBVIEW_PREFS_NAME, Context.MODE_PRIVATE);
        String persistedServerPath = normalizeNullableString(
            preferences.getString(WebView.CAP_SERVER_PATH, null)
        );
        if (persistedServerPath == null) {
            return;
        }

        File updateRoot = getUpdateRootDir();
        String updateRootPath = normalizeNullableString(updateRoot.getAbsolutePath());
        if (updateRootPath == null || !persistedServerPath.startsWith(updateRootPath)) {
            return;
        }

        File persistedIndex = new File(persistedServerPath, "index.html");
        if (!persistedIndex.exists()) {
            clearCorruptUpdateDataForFallback(
                "Persisted update launch path is invalid."
            );
        }
    }

    private static JSONObject createApplyResult(
        boolean ok,
        boolean applied,
        boolean alreadyInstalled,
        String buildId,
        boolean reloadTriggered,
        boolean clientUpdateRequired,
        String error
    ) {
        JSONObject result = new JSONObject();
        try {
            result.put("ok", ok);
            result.put("applied", applied);
            result.put("alreadyInstalled", alreadyInstalled);
            result.put("buildId", buildId);
            result.put("reloadTriggered", reloadTriggered);
            result.put("clientUpdateRequired", clientUpdateRequired);
            result.put("error", error);
        } catch (JSONException ignored) {
            // Ignore JSON serialization errors for these fixed keys.
        }
        return result;
    }

    private static String resolveManifestFileUrl(
        String manifestUrl,
        String filesBasePath,
        String relativeFilePath,
        String explicitFileUrl
    ) throws IOException {
        URL baseUrl = new URL(manifestUrl);
        String normalizedExplicitUrl = normalizeNullableString(explicitFileUrl);
        if (normalizedExplicitUrl != null) {
            return new URL(baseUrl, normalizedExplicitUrl).toString();
        }
        String normalizedBasePath = trimTrailingSlash(filesBasePath);
        String normalizedRelativePath = relativeFilePath.replace("\\", "/");
        while (normalizedRelativePath.startsWith("/")) {
            normalizedRelativePath = normalizedRelativePath.substring(1);
        }
        return new URL(baseUrl, normalizedBasePath + "/" + normalizedRelativePath).toString();
    }

    private JSONObject applyGameUpdateInternal(String manifestUrlValue) {
        String manifestUrl = normalizeNullableString(manifestUrlValue);
        if (manifestUrl == null) {
            return createApplyResult(
                false,
                false,
                false,
                null,
                false,
                false,
                "Update manifest URL is required."
            );
        }

        File stagingBuildDir = null;
        try {
            JSONObject manifest = fetchJsonFromUrl(manifestUrl);
            JSONObject latest = manifest.optJSONObject("latest");
            if (latest == null) {
                return createApplyResult(
                    false,
                    false,
                    false,
                    null,
                    false,
                    false,
                    "Update manifest payload is invalid."
                );
            }

            String buildId = normalizeNullableString(latest.optString("buildId", null));
            String filesBasePath = normalizeSafeRelativePath(latest.optString("filesBasePath", null));
            JSONArray files = latest.optJSONArray("files");
            if (buildId == null || filesBasePath == null || files == null || files.length() == 0) {
                return createApplyResult(
                    false,
                    false,
                    false,
                    null,
                    false,
                    false,
                    "Update manifest latest build payload is incomplete."
                );
            }

            JSONObject activeUpdate = readActiveUpdateInfo();
            if (activeUpdate != null && buildId.equals(activeUpdate.optString("buildId", ""))) {
                return createApplyResult(
                    true,
                    false,
                    true,
                    buildId,
                    false,
                    latest.optBoolean("requiresClientUpgrade", false),
                    null
                );
            }

            String localReuseRootPath = null;
            if (activeUpdate != null) {
                localReuseRootPath =
                    normalizeNullableString(activeUpdate.optString("buildRootPath", null));
            }
            if (localReuseRootPath == null) {
                File currentBuildDir = getUpdateCurrentDir();
                if (currentBuildDir.exists() && currentBuildDir.isDirectory()) {
                    localReuseRootPath = currentBuildDir.getAbsolutePath();
                }
            }

            stagingBuildDir = new File(getUpdateStagingDir(), UPDATE_CURRENT_DIR_NAME);
            deleteRecursively(stagingBuildDir);
            if (!stagingBuildDir.mkdirs() && !stagingBuildDir.exists()) {
                throw new IOException(
                    "Unable to create staging directory: " + stagingBuildDir.getAbsolutePath()
                );
            }

            for (int index = 0; index < files.length(); index += 1) {
                JSONObject fileEntry = files.optJSONObject(index);
                if (fileEntry == null) {
                    throw new IOException("Update file entry is invalid at index " + index + ".");
                }
                String relativePath = normalizeSafeRelativePath(fileEntry.optString("path", null));
                if (relativePath == null) {
                    throw new IOException("Update file path is invalid.");
                }

                long expectedSize =
                    fileEntry.has("size") && !fileEntry.isNull("size")
                        ? Math.max(0L, fileEntry.optLong("size", -1L))
                        : -1L;
                String expectedSha = normalizeNullableString(fileEntry.optString("sha256", null));
                String explicitUrl = normalizeNullableString(fileEntry.optString("url", null));

                String sourceUrl = resolveManifestFileUrl(
                    manifestUrl,
                    filesBasePath,
                    relativePath,
                    explicitUrl
                );
                File destinationFile = new File(stagingBuildDir, relativePath.replace("/", File.separator));
                boolean reusedLocally = false;
                if (localReuseRootPath != null && expectedSha != null) {
                    File localSourceFile = new File(
                        localReuseRootPath,
                        relativePath.replace("/", File.separator)
                    );
                    reusedLocally = tryReuseLocalFileWithMatchingHash(
                        localSourceFile,
                        destinationFile,
                        expectedSha
                    );
                }

                if (!reusedLocally) {
                    downloadFileWithValidation(sourceUrl, destinationFile, expectedSize, expectedSha);
                }
            }

            File indexFile = new File(stagingBuildDir, "index.html");
            if (!indexFile.exists()) {
                throw new IOException("Downloaded update does not include index.html.");
            }

            File updateRootDir = getUpdateRootDir();
            if (!updateRootDir.exists() && !updateRootDir.mkdirs()) {
                throw new IOException("Unable to create update root directory.");
            }
            File targetBuildDir = getUpdateCurrentDir();
            deleteRecursively(targetBuildDir);
            if (!stagingBuildDir.renameTo(targetBuildDir)) {
                copyRecursively(stagingBuildDir, targetBuildDir);
                deleteRecursively(stagingBuildDir);
            }

            JSONObject nextActiveUpdate = new JSONObject();
            String updatedAt = getCurrentTimestampIsoUtc();
            nextActiveUpdate.put("buildId", buildId);
            nextActiveUpdate.put("buildRootPath", targetBuildDir.getAbsolutePath());
            nextActiveUpdate.put("commitSha", normalizeNullableString(latest.optString("commitSha", null)));
            nextActiveUpdate.put("updatedAt", updatedAt);
            nextActiveUpdate.put("manifestUrl", manifestUrl);
            nextActiveUpdate.put("clientVersion", normalizeNullableString(latest.optString("clientVersion", null)));

            writeTextFile(getActiveUpdateMetadataFile(), nextActiveUpdate.toString(2));
            persistServerBasePath(targetBuildDir.getAbsolutePath());
            applyServerBasePath(targetBuildDir.getAbsolutePath());

            return createApplyResult(
                true,
                true,
                false,
                buildId,
                true,
                latest.optBoolean("requiresClientUpgrade", false),
                null
            );
        } catch (Exception exception) {
            if (stagingBuildDir != null) {
                deleteRecursively(stagingBuildDir);
            }
            return createApplyResult(
                false,
                false,
                false,
                null,
                false,
                false,
                exception.getMessage() != null
                    ? exception.getMessage()
                    : "Failed to apply Android update."
            );
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

        @JavascriptInterface
        public String getActiveGameUpdateInfo() {
            JSONObject activeUpdateInfo = readActiveUpdateInfo();
            String fallbackNotice = readAndClearUpdateFallbackNotice();
            if (activeUpdateInfo == null && fallbackNotice == null) {
                return "null";
            }
            try {
                JSONObject response = activeUpdateInfo != null ? activeUpdateInfo : new JSONObject();
                if (fallbackNotice != null) {
                    response.put("hostWarningMessage", fallbackNotice);
                }
                return response.toString();
            } catch (JSONException ignored) {
                if (fallbackNotice != null) {
                    JSONObject fallbackOnly = new JSONObject();
                    try {
                        fallbackOnly.put("hostWarningMessage", fallbackNotice);
                    } catch (JSONException nestedIgnored) {
                        // Ignore serialization failures and fall back to null.
                    }
                    return fallbackOnly.toString();
                }
                return "null";
            }
        }

        @JavascriptInterface
        public String applyGameUpdate(String manifestUrl) {
            return applyGameUpdateInternal(manifestUrl).toString();
        }
    }
}
