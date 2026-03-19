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
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.TimeZone;

public class MainActivity extends BridgeActivity {

    private static final String UPDATE_ROOT_DIR_NAME = "nh3d-game-updates";
    private static final String UPDATE_BUILDS_DIR_NAME = "builds";
    private static final String UPDATE_STAGING_DIR_NAME = "staging";
    private static final String ACTIVE_UPDATE_FILE_NAME = "active-update.json";
    private static final int MAX_STORED_BUILDS = 3;
    private static final int NETWORK_CONNECT_TIMEOUT_MS = 30000;
    private static final int NETWORK_READ_TIMEOUT_MS = 30000;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new Nh3dAndroidBridge(), "nh3dAndroid");
        }
    }

    private File getUpdateRootDir() {
        return new File(getFilesDir(), UPDATE_ROOT_DIR_NAME);
    }

    private File getUpdateBuildsDir() {
        return new File(getUpdateRootDir(), UPDATE_BUILDS_DIR_NAME);
    }

    private File getUpdateStagingDir() {
        return new File(getUpdateRootDir(), UPDATE_STAGING_DIR_NAME);
    }

    private File getActiveUpdateMetadataFile() {
        return new File(getUpdateRootDir(), ACTIVE_UPDATE_FILE_NAME);
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
                return null;
            }
            File indexFile = new File(buildRootPath, "index.html");
            if (!indexFile.exists()) {
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
        } catch (Exception ignored) {
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

    private void applyServerBasePath(String serverBasePath) {
        runOnUiThread(() -> {
            if (getBridge() != null) {
                getBridge().setServerBasePath(serverBasePath);
            }
        });
    }

    private void pruneStoredBuilds(String activeBuildId) {
        File buildsDir = getUpdateBuildsDir();
        if (!buildsDir.exists()) {
            return;
        }
        File[] entries = buildsDir.listFiles();
        if (entries == null || entries.length == 0) {
            return;
        }
        List<File> buildDirectories = new ArrayList<>();
        for (File entry : entries) {
            if (entry.isDirectory()) {
                buildDirectories.add(entry);
            }
        }
        Collections.sort(
            buildDirectories,
            (left, right) -> Long.compare(right.lastModified(), left.lastModified())
        );

        int keptCount = 0;
        for (File buildDir : buildDirectories) {
            boolean shouldKeep =
                buildDir.getName().equals(activeBuildId) || keptCount < MAX_STORED_BUILDS;
            if (shouldKeep) {
                keptCount += 1;
                continue;
            }
            deleteRecursively(buildDir);
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

            stagingBuildDir = new File(getUpdateStagingDir(), buildId);
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

                downloadFileWithValidation(sourceUrl, destinationFile, expectedSize, expectedSha);
            }

            File indexFile = new File(stagingBuildDir, "index.html");
            if (!indexFile.exists()) {
                throw new IOException("Downloaded update does not include index.html.");
            }

            File buildsDir = getUpdateBuildsDir();
            if (!buildsDir.exists() && !buildsDir.mkdirs()) {
                throw new IOException("Unable to create update builds directory.");
            }
            File targetBuildDir = new File(buildsDir, buildId);
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
            pruneStoredBuilds(buildId);

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
            return activeUpdateInfo != null ? activeUpdateInfo.toString() : "null";
        }

        @JavascriptInterface
        public String applyGameUpdate(String manifestUrl) {
            return applyGameUpdateInternal(manifestUrl).toString();
        }
    }
}
