package org.openframe.player;

import java.security.MessageDigest;
import java.security.SecureRandom;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

final class KioskPin {
    static String salt() {
        byte[] bytes = new byte[16];
        new SecureRandom().nextBytes(bytes);
        return java.util.Base64.getEncoder().encodeToString(bytes);
    }
    static String hash(String pin, String salt) {
        PBEKeySpec spec = new PBEKeySpec(pin.toCharArray(), java.util.Base64.getDecoder().decode(salt), 100000, 256);
        try {
            return java.util.Base64.getEncoder().encodeToString(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded());
        } catch (java.security.GeneralSecurityException ex) { throw new IllegalStateException(ex); }
        finally { spec.clearPassword(); }
    }
    static boolean verify(String pin, String salt, String expected) {
        return MessageDigest.isEqual(hash(pin, salt).getBytes(java.nio.charset.StandardCharsets.UTF_8),
                expected.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
}
