import os
import unittest
from unittest.mock import patch

from dashboard import app
from psx_tools import find_stocks


class PsxDirectoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.token_patch = patch.dict(os.environ, {"CAPITALSTAKE_TOKEN": ""})
        self.token_patch.start()

    def tearDown(self) -> None:
        self.token_patch.stop()

    def test_lists_psx_companies_without_capitalstake(self) -> None:
        result = find_stocks(limit=2)

        self.assertEqual(result["total_matches"], 758)
        self.assertEqual(result["returned"], 2)
        self.assertTrue(result["stocks"][0]["name"])
        self.assertTrue(result["stocks"][0]["sector"])
        self.assertEqual(len(result["sectors"]), 37)

    def test_searches_company_name_and_sector(self) -> None:
        result = find_stocks(query="habib bank")
        self.assertEqual([row["symbol"] for row in result["stocks"]], ["HBL"])

        cement = find_stocks(sector="cement")
        self.assertGreater(cement["total_matches"], 0)
        self.assertTrue(all(row["sector"] == "CEMENT" for row in cement["stocks"]))

    def test_stocks_endpoint_serves_directory_and_company_details(self) -> None:
        client = app.test_client()

        listings = client.get("/api/stocks?page=1&limit=3")
        self.assertEqual(listings.status_code, 200)
        self.assertEqual(len(listings.json["stocks"]), 3)

        detail = client.get("/api/stock/HBL")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json["stock"]["name"], "Habib Bank Limited")
        self.assertIsNone(detail.json["quote"].get("last"))

    def test_unknown_directory_symbol_returns_not_found(self) -> None:
        response = app.test_client().get("/api/stock/NOTAREALCOMPANY")
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
