import unittest

from utils.cors import _is_local_origin, _origin_matches


class CorsTests(unittest.TestCase):
    def test_matches_with_trailing_slash_and_case(self):
        self.assertTrue(
            _origin_matches("https://smartconnect4u.com", "https://SMARTCONNECT4U.com/")
        )

    def test_matches_wildcard_subdomain(self):
        self.assertTrue(
            _origin_matches("https://www.smartconnect4u.com", "https://*.smartconnect4u.com")
        )

    def test_does_not_match_different_host(self):
        self.assertFalse(
            _origin_matches("https://evil-example.com", "https://*.smartconnect4u.com")
        )

    def test_scheme_and_port_are_enforced_when_configured(self):
        self.assertTrue(
            _origin_matches("https://portal.smartconnect4u.com:8443", "https://portal.smartconnect4u.com:8443")
        )
        self.assertFalse(
            _origin_matches("https://portal.smartconnect4u.com:8444", "https://portal.smartconnect4u.com:8443")
        )

    def test_host_only_entry_matches_http_and_https(self):
        self.assertTrue(_origin_matches("http://smartconnect4u.com", "smartconnect4u.com"))
        self.assertTrue(_origin_matches("https://smartconnect4u.com", "smartconnect4u.com"))

    def test_local_origin_supports_https_localhost(self):
        self.assertTrue(_is_local_origin("http://localhost:5173"))
        self.assertTrue(_is_local_origin("https://localhost:5173"))
        self.assertTrue(_is_local_origin("http://127.0.0.1:5173"))
        self.assertFalse(_is_local_origin("https://smartconnect4u.com"))


if __name__ == "__main__":
    unittest.main()
