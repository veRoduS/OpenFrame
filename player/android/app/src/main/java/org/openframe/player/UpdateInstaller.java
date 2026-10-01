package org.openframe.player;

import android.content.Context;
import android.content.Intent;
import android.content.ClipData;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import java.io.File;
import java.io.IOException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

final class UpdateInstaller {
    static void verify(Context context, UpdateSource.Release release, File file) throws Exception {
        UpdateSource.verifyFile(release, file);
        PackageManager manager = context.getPackageManager();
        PackageInfo installed = manager.getPackageInfo(context.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
        if (!release.newerThan(installed.packageName, installed.getLongVersionCode(), Build.VERSION.SDK_INT))
            throw new IOException("This update is not newer than the installed player.");
        PackageInfo candidate = manager.getPackageArchiveInfo(file.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
        if (candidate == null || !installed.packageName.equals(candidate.packageName) ||
                candidate.getLongVersionCode() != release.versionCode || !release.versionName.equals(candidate.versionName) ||
                candidate.applicationInfo == null || candidate.applicationInfo.minSdkVersion > Build.VERSION.SDK_INT ||
                installed.signingInfo == null || candidate.signingInfo == null ||
                !sameSigners(installed.signingInfo.getApkContentsSigners(), candidate.signingInfo.getApkContentsSigners()))
            throw new IOException("This APK does not match the installed OpenFrame app and signing key.");
    }

    private static boolean sameSigners(Signature[] installed, Signature[] candidate) {
        if (installed == null || candidate == null || installed.length == 0 || candidate.length == 0) return false;
        Set<Signature> expected = new HashSet<>(Arrays.asList(installed));
        return expected.equals(new HashSet<>(Arrays.asList(candidate)));
    }

    static Intent intent(Context context) {
        Uri uri = Uri.parse("content://" + context.getPackageName() + ".updates/update.apk");
        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.setClipData(ClipData.newRawUri("OpenFrame update", uri));
        return intent;
    }
}
