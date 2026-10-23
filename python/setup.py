import shutil
from pathlib import Path

from setuptools import find_packages, setup
from setuptools.command.build_py import build_py
from setuptools.command.sdist import sdist


ROOT = Path(__file__).resolve().parent


def copy_assets(package_directory):
    for name in ("docs", "ui"):
        source = ROOT.parent / name
        if source.is_dir():
            shutil.copytree(source, package_directory / name, dirs_exist_ok=True)


class BuildPy(build_py):
    def run(self):
        super().run()
        copy_assets(Path(self.build_lib) / "mulebot")


class Sdist(sdist):
    def make_release_tree(self, base_dir, files):
        super().make_release_tree(base_dir, files)
        copy_assets(Path(base_dir) / "mulebot")


setup(
    name="mulebot",
    author="John Friedman",
    version="0.2.0",
    description="A simple chatbot for Datamule's APIs",
    url="https://github.com/john-friedman/mulebot",
    license="MIT",
    packages=find_packages(),
    python_requires=">=3.10",
    install_requires=["sqlglot>=30.24,<31"],
    entry_points={"console_scripts": ["mulebot=mulebot.cli:main"]},
    include_package_data=True,
    package_data={"mulebot": ["docs/*.md", "docs/*.yaml", "ui/templates/*.html", "ui/static/*.js", "ui/static/*.css"]},
    cmdclass={"build_py": BuildPy, "sdist": Sdist},
)
